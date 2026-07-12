// 制御プレーンのジョブキュー: 複数repoへの2AIOジョブを永続化して直列/少数並列で消化する。
// 記録思想は既存(runs/・history/)を踏襲: control/queue.json に全ジョブを残し、追跡可能にする。
import fs from 'node:fs';
import path from 'node:path';

const dirOf = (root) => path.join(root, 'control');
const fileOf = (root) => path.join(dirOf(root), 'queue.json');
const ensure = (p) => fs.mkdirSync(p, { recursive: true });

let seq = 0;
const newId = () => Date.now().toString(36) + '-' + (seq++).toString(36);

export const STATES = ['queued', 'running', 'done', 'failed', 'canceled', 'interrupted', 'skipped'];

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
  const DEAD = ['failed', 'canceled', 'interrupted', 'skipped'];
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
