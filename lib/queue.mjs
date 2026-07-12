// 制御プレーンのジョブキュー: 複数repoへの2AIOジョブを永続化して直列/少数並列で消化する。
// 記録思想は既存(runs/・history/)を踏襲: control/queue.json に全ジョブを残し、追跡可能にする。
import fs from 'node:fs';
import path from 'node:path';

const dirOf = (root) => path.join(root, 'control');
const fileOf = (root) => path.join(dirOf(root), 'queue.json');
const ensure = (p) => fs.mkdirSync(p, { recursive: true });

let seq = 0;
const newId = () => Date.now().toString(36) + '-' + (seq++).toString(36);

export const STATES = ['queued', 'running', 'done', 'failed', 'canceled'];

export function loadQueue(root) {
  try { return JSON.parse(fs.readFileSync(fileOf(root), 'utf8')); } catch { return []; }
}
export function saveQueue(root, jobs) {
  ensure(dirOf(root));
  fs.writeFileSync(fileOf(root), JSON.stringify(jobs, null, 2));
}

// ジョブ投入。repo(id)・kind(build/plan/start/research等)・args(自由)・prompt(実行文)を受ける。
export function enqueue(root, { repo, kind, args = {}, prompt = '' }) {
  const jobs = loadQueue(root);
  const job = {
    id: newId(), repo, kind, args, prompt,
    state: 'queued', createdAt: new Date().toISOString(),
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
export function nextQueued(root) {
  const q = loadQueue(root).filter(j => j.state === 'queued');
  q.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  return q[0] || null;
}

// キューに積まれた(まだ走っていない)ジョブのみキャンセル可能。実行中は別途プロセス停止が要る。
export function cancel(root, id) {
  const j = getJob(root, id);
  if (!j) return { ok: false, err: 'ジョブが見つからない' };
  if (j.state !== 'queued') return { ok: false, err: `state=${j.state} はキャンセル不可(queuedのみ)` };
  updateJob(root, id, { state: 'canceled', endedAt: new Date().toISOString() });
  return { ok: true };
}
