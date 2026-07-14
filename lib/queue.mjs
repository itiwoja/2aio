// 制御プレーンのジョブキュー: 複数repoへの2AIOジョブを永続化して直列/少数並列で消化する。
// 記録思想は既存(runs/・history/)を踏襲: control/queue.json に全ジョブを残し、追跡可能にする。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dirOf = (root) => path.join(root, 'control');
const fileOf = (root) => path.join(dirOf(root), 'queue.json');
const ensure = (p) => fs.mkdirSync(p, { recursive: true });

// #64: seq はプロセスローカル連番のためサーバダウン中の複数 CLI fallback（scripts/enqueue.mjs）が
// 同一msかつ各々seq=0で衝突しうる（サーバ稼働中は単一プロセス採番のため衝突しない — 対象はダウン中限定）。
// crypto.randomBytes を連結し衝突確率を実質ゼロにする（token.mjs で既に導入済み・新規依存ゼロ）。
let seq = 0;
const newId = () => Date.now().toString(36) + '-' + (seq++).toString(36) + '-' + crypto.randomBytes(4).toString('hex');

export const STATES = ['queued', 'running', 'done', 'failed', 'canceled', 'interrupted', 'skipped', 'waiting_approval', 'waiting_review', 'blocked'];

// 起動時リコンシリエーションで自動再キューしてよい「冪等な軽量kind」(#10)。
// implement/build は半端な git 状態への無人再実行を防ぐため interrupted のまま手動再投入。
export const LIGHT_KINDS = ['analyze', 'test', 'review', 'refactor'];

export function loadQueue(root) {
  try { return JSON.parse(fs.readFileSync(fileOf(root), 'utf8')); } catch { return []; }
}
// temp+rename のアトミック書込み (#10) — CLI 直接投入との二重書込みで queue.json が壊れるのを防ぐ。
export function saveQueue(root, jobs) {
  ensure(dirOf(root));
  const tmp = fileOf(root) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(jobs, null, 2));
  fs.renameSync(tmp, fileOf(root));
}

// ジョブ投入。repo(id)・kind(build/plan/start/research等)・args(自由)・prompt(実行文)を受ける。
// notBefore(ISO) を指定するとその時刻までは nextQueued に出てこない(スケジュール投入 #10)。
// dependsOn(jobId) を指定すると前段が done になるまで起動されない(依存ジョブ連鎖 #12)。
export function enqueue(root, { repo, kind, args = {}, prompt = '', notBefore = null, dependsOn = null }) {
  const jobs = loadQueue(root);
  const job = {
    id: newId(), repo, kind, args, prompt,
    state: 'queued', createdAt: new Date().toISOString(),
    notBefore, attempts: 0, dependsOn,
    startedAt: null, endedAt: null, exit: null,
    tokensBefore: null, tokensAfter: null, log: [],
  };
  jobs.unshift(job);
  saveQueue(root, jobs);
  return job;
}

export function getJob(root, id) { return loadQueue(root).find(j => j.id === id) || null; }

export function updateJob(root, id, patch) {
  const jobs = loadQueue(root);
  const j = jobs.find(x => x.id === id);
  if (!j) return null;
  Object.assign(j, patch);
  saveQueue(root, jobs);
  return j;
}

export function countRunning(root) { return loadQueue(root).filter(j => j.state === 'running').length; }

// #63: waiting_review / waiting_approval は「依存を充足しない終端的ポーズ」と正式定義する
// （いずれ人手で done か次アクションへ遷移する状態で、下の nextQueued からは done 未達＝非起動、
// propagateSkips の DEAD にも含まれない＝非skip、のどちらでもある）。
// この2状態になりうる kind（idd-mvp / implement 等）を dependsOn の対象にしない — 必ず連鎖の末尾に置くこと。
// 跨いで自動連鎖したい要求が出た場合は、承認/レビュー完了→done へ遷移させる resume 経路の設計が必要（v2）。
//
// 次に起動すべきジョブ(投入が古い順)。無ければ null。
// notBefore が未来のジョブ、および依存(dependsOn)が done になっていないジョブはスキップする。
export function nextQueued(root, now = new Date()) {
  const jobs = loadQueue(root);
  const byId = new Map(jobs.map(j => [j.id, j]));
  const q = jobs.filter(j =>
    j.state === 'queued'
    && (!j.notBefore || new Date(j.notBefore) <= now)
    && (!j.dependsOn || byId.get(j.dependsOn)?.state === 'done'));
  q.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return q[0] || null;
}

// 依存ジョブ連鎖の失敗伝播 (#12): 前段が failed/canceled/interrupted/skipped で終わった
// 後続 queued を 'skipped' に落とす(連鎖的に伝播)。tick のたびに呼んで安全(冪等)。
export function propagateSkips(root) {
  const jobs = loadQueue(root);
  const byId = new Map(jobs.map(j => [j.id, j]));
  const DEAD = ['failed', 'canceled', 'interrupted', 'skipped', 'blocked'];
  const skipped = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const j of jobs) {
      if (j.state !== 'queued' || !j.dependsOn) continue;
      const dep = byId.get(j.dependsOn);
      if (dep && DEAD.includes(dep.state)) {
        Object.assign(j, { state: 'skipped', endedAt: new Date().toISOString() });
        skipped.push(j.id); changed = true;
      }
    }
  }
  if (skipped.length) saveQueue(root, jobs);
  return skipped;
}

// 起動時リコンシリエーション (#10): state==='running' なのに生きたプロセスが無いジョブを
// 'interrupted' に落とす(孤児1件で maxConcurrency=1 が永久に塞がるデッドロックの復旧)。
// 冪等な軽量kind(LIGHT_KINDS)のみ attempts<maxAttempts の範囲で自動再キューする。
export function reconcile(root, isAlive = () => false, { maxAttempts = 2 } = {}) {
  const jobs = loadQueue(root);
  const result = { interrupted: [], requeued: [] };
  for (const j of jobs) {
    if (j.state !== 'running' || isAlive(j.id)) continue;
    const attempts = (j.attempts || 0) + 1;
    if (LIGHT_KINDS.includes(j.kind) && attempts < maxAttempts) {
      Object.assign(j, { state: 'queued', attempts, startedAt: null, endedAt: null });
      result.requeued.push(j.id);
    } else {
      Object.assign(j, { state: 'interrupted', attempts, endedAt: new Date().toISOString() });
      result.interrupted.push(j.id);
    }
  }
  if (result.interrupted.length || result.requeued.length) saveQueue(root, jobs);
  return result;
}

// キューに積まれた(まだ走っていない)ジョブのみキャンセル可能。実行中は別途プロセス停止が要る。
export function cancel(root, id) {
  const j = getJob(root, id);
  if (!j) return { ok: false, err: 'ジョブが見つからない' };
  if (j.state !== 'queued') return { ok: false, err: `state=${j.state} はキャンセル不可(queuedのみ)` };
  updateJob(root, id, { state: 'canceled', endedAt: new Date().toISOString() });
  return { ok: true };
}

// ── 失敗サーキットブレーカ（Wave A / Hermes kanban dispatch_once の概念借用・MIT） ──
// 同一 repo で失敗が連続したら理由付きで 'blocked' に落とし、無駄な再投入スピンを止める。
// budget は governor が起動前に gate 済みなので、ここではワーカー実行中に踏んだ rate-limit のみ
// 「失敗に数えない」区別を持つ（Hermes と同じく一過性の quota 壁を恒久失敗と混同しないため）。
export const FAILURE_STATES = ['failed', 'interrupted', 'blocked'];
export const RESET_STATES = ['done', 'waiting_review', 'waiting_approval'];
export const DEFAULT_FAILURE_LIMIT = 3;

// 失敗理由がレートリミット/クオータ由来か（サーキットブレーカのカウント対象外にする）。
export function isRateLimited(reason) {
  return /rate.?limit|\b429\b|quota|overloaded|too many requests/i.test(String(reason || ''));
}

// repo の「直近の連続失敗数」。endedAt 降順に見て、成功系(RESET_STATES)に当たったら打ち切り。
// canceled/skipped は中立（数えず・打ち切りもしない）。rate-limit 由来の失敗は無視して継続。
// excludeId は「今まさに判定中の当該ジョブ」を除外するため。
export function repoFailureStreak(jobs, repo, { excludeId = null } = {}) {
  const terminated = jobs
    .filter(j => j.repo === repo && j.id !== excludeId && j.endedAt)
    .sort((a, b) => (a.endedAt < b.endedAt ? 1 : -1)); // 新しい順
  let streak = 0;
  for (const j of terminated) {
    if (RESET_STATES.includes(j.state)) break;
    if (FAILURE_STATES.includes(j.state) && !isRateLimited(j.failReason)) streak++;
  }
  return streak;
}

// 当該ジョブの失敗を受けて 'blocked' にすべきかを判定する純関数。
// code===0（成功）や rate-limit 由来ではブロックしない。連続失敗が failureLimit に達したらブロック。
export function breakerDecision(jobs, job, { code, failReason, failureLimit = DEFAULT_FAILURE_LIMIT } = {}) {
  if (code === 0) return { block: false };
  if (isRateLimited(failReason)) return { block: false };
  const streak = repoFailureStreak(jobs, job.repo, { excludeId: job.id }) + 1; // 今回の失敗を含める
  if (streak < failureLimit) return { block: false, streak };
  const last = failReason || (typeof code === 'number' ? `exit ${code}` : 'error');
  return { block: true, streak, reason: `${failureLimit}回連続失敗のため blocked（repo: ${job.repo}）。最新の失敗: ${last}` };
}
