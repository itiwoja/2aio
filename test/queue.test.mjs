// キューのテスト: 投入・取り出し順・状態遷移・キャンセル境界を検証する。
// 実行: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueue, loadQueue, nextQueued, updateJob, countRunning, cancel, reconcile, propagateSkips, repoFailureStreak, breakerDecision, isRateLimited } from '../lib/queue.mjs';

function tmpRoot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), '2aio-queue-'));
  return d;
}

test('enqueue → queued で積まれ、loadQueue で読める', () => {
  const root = tmpRoot();
  const job = enqueue(root, { repo: 'r1', kind: 'build', args: { theme: 'x' } });
  assert.equal(job.state, 'queued');
  const all = loadQueue(root);
  assert.equal(all.length, 1);
  assert.equal(all[0].id, job.id);
});

test('nextQueued は投入が古い順に返す', async () => {
  const root = tmpRoot();
  const a = enqueue(root, { repo: 'r1', kind: 'build' });
  // createdAt を古く上書きして順序を確定させる
  updateJob(root, a.id, { createdAt: '2020-01-01T00:00:00.000Z' });
  const b = enqueue(root, { repo: 'r1', kind: 'build' });
  updateJob(root, b.id, { createdAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(nextQueued(root).id, a.id);
});

test('running への遷移で countRunning が増える', () => {
  const root = tmpRoot();
  const j = enqueue(root, { repo: 'r1', kind: 'build' });
  assert.equal(countRunning(root), 0);
  updateJob(root, j.id, { state: 'running' });
  assert.equal(countRunning(root), 1);
});

test('cancel は queued のみ可・running は不可', () => {
  const root = tmpRoot();
  const j = enqueue(root, { repo: 'r1', kind: 'build' });
  updateJob(root, j.id, { state: 'running' });
  const r1 = cancel(root, j.id);
  assert.equal(r1.ok, false);

  const k = enqueue(root, { repo: 'r1', kind: 'build' });
  const r2 = cancel(root, k.id);
  assert.equal(r2.ok, true);
  assert.equal(loadQueue(root).find(x => x.id === k.id).state, 'canceled');
});

test('canceled/running は nextQueued に出てこない', () => {
  const root = tmpRoot();
  const a = enqueue(root, { repo: 'r1', kind: 'build' });
  updateJob(root, a.id, { state: 'running' });
  const b = enqueue(root, { repo: 'r1', kind: 'build' });
  cancel(root, b.id);
  assert.equal(nextQueued(root), null);
});

// ── #10 キュー堅牢化 ──

test('notBefore が未来のジョブは nextQueued に出てこない・時刻到達で出てくる', () => {
  const root = tmpRoot();
  const j = enqueue(root, { repo: 'r1', kind: 'test', notBefore: '2026-07-13T02:00:00.000Z' });
  assert.equal(nextQueued(root, new Date('2026-07-13T01:59:00.000Z')), null);
  assert.equal(nextQueued(root, new Date('2026-07-13T02:00:01.000Z')).id, j.id);
});

test('reconcile: 孤児 running の軽量kind(analyze) は自動再キュー(attempts+1)', () => {
  const root = tmpRoot();
  const j = enqueue(root, { repo: 'r1', kind: 'analyze' });
  updateJob(root, j.id, { state: 'running' });
  const r = reconcile(root, () => false);
  assert.deepEqual(r.requeued, [j.id]);
  const after = loadQueue(root).find(x => x.id === j.id);
  assert.equal(after.state, 'queued');
  assert.equal(after.attempts, 1);
});

test('reconcile: 孤児 running の重量kind(implement) は interrupted のまま（無人再実行しない）', () => {
  const root = tmpRoot();
  const j = enqueue(root, { repo: 'r1', kind: 'implement' });
  updateJob(root, j.id, { state: 'running' });
  const r = reconcile(root, () => false);
  assert.deepEqual(r.interrupted, [j.id]);
  assert.equal(loadQueue(root).find(x => x.id === j.id).state, 'interrupted');
});

test('reconcile: 軽量kindも maxAttempts 到達で interrupted に落ちる', () => {
  const root = tmpRoot();
  const j = enqueue(root, { repo: 'r1', kind: 'analyze' });
  updateJob(root, j.id, { state: 'running', attempts: 1 });
  const r = reconcile(root, () => false, { maxAttempts: 2 });
  assert.deepEqual(r.interrupted, [j.id]);
});

// ── #12 依存ジョブ連鎖 ──

test('dependsOn: 前段が done になるまで nextQueued に出てこない', () => {
  const root = tmpRoot();
  const a = enqueue(root, { repo: 'r1', kind: 'plan' });
  updateJob(root, a.id, { createdAt: '2020-01-01T00:00:00.000Z' });
  const b = enqueue(root, { repo: 'r1', kind: 'implement', dependsOn: a.id });
  updateJob(root, a.id, { state: 'running' });
  assert.equal(nextQueued(root), null);
  updateJob(root, a.id, { state: 'done' });
  assert.equal(nextQueued(root).id, b.id);
});

test('dependsOn: 前段が waiting_review で停止すると後続は永久 queued（起動もskipもされない）', () => {
  // #63: waiting_* は「依存を充足しない終端的ポーズ」。done ではないので nextQueued は起動しない。
  // failed/canceled/interrupted/skipped の DEAD にも含まれないので propagateSkips も skip しない。
  // waiting_* になりうる kind（idd-mvp/implement等）を dependsOn 対象にしない運用を前提とする不変条件。
  const root = tmpRoot();
  const a = enqueue(root, { repo: 'r1', kind: 'implement' });
  const b = enqueue(root, { repo: 'r1', kind: 'implement', dependsOn: a.id });
  updateJob(root, a.id, { state: 'waiting_review' });
  assert.equal(nextQueued(root), null);
  const skipped = propagateSkips(root);
  assert.deepEqual(skipped, []);
  assert.equal(loadQueue(root).find((j) => j.id === b.id).state, 'queued');
});

test('propagateSkips: 前段 failed で後続が skipped に落ち、連鎖的に伝播する', () => {
  const root = tmpRoot();
  const a = enqueue(root, { repo: 'r1', kind: 'plan' });
  const b = enqueue(root, { repo: 'r1', kind: 'implement', dependsOn: a.id });
  const c = enqueue(root, { repo: 'r1', kind: 'implement', dependsOn: b.id });
  updateJob(root, a.id, { state: 'failed' });
  const skipped = propagateSkips(root);
  assert.deepEqual(skipped.sort(), [b.id, c.id].sort());
  assert.equal(loadQueue(root).find(x => x.id === c.id).state, 'skipped');
});

test('propagateSkips: 前段 done なら何もしない(冪等)', () => {
  const root = tmpRoot();
  const a = enqueue(root, { repo: 'r1', kind: 'plan' });
  enqueue(root, { repo: 'r1', kind: 'implement', dependsOn: a.id });
  updateJob(root, a.id, { state: 'done' });
  assert.deepEqual(propagateSkips(root), []);
  assert.deepEqual(propagateSkips(root), []);
});

test('reconcile: 生きているプロセスのジョブは触らない', () => {
  const root = tmpRoot();
  const j = enqueue(root, { repo: 'r1', kind: 'analyze' });
  updateJob(root, j.id, { state: 'running' });
  const r = reconcile(root, (id) => id === j.id);
  assert.deepEqual(r, { interrupted: [], requeued: [] });
  assert.equal(loadQueue(root).find(x => x.id === j.id).state, 'running');
});

// ── 失敗サーキットブレーカ ──

const failed = (repo, endedAt, failReason = 'exit 1', state = 'failed') =>
  ({ id: `${repo}-${endedAt}`, repo, state, endedAt, failReason });

test('repoFailureStreak: 連続失敗を新しい順に数え、done で打ち切る', () => {
  const jobs = [
    failed('r1', '2026-07-14T03:00:00.000Z'),
    failed('r1', '2026-07-14T02:00:00.000Z', 'exit 1', 'interrupted'),
    { id: 'ok', repo: 'r1', state: 'done', endedAt: '2026-07-14T01:00:00.000Z' },
    failed('r1', '2026-07-14T00:00:00.000Z'), // done より前なので数えない
  ];
  assert.equal(repoFailureStreak(jobs, 'r1'), 2);
});

test('repoFailureStreak: rate-limit 由来の失敗は数えない、他 repo は無関係', () => {
  const jobs = [
    failed('r1', '2026-07-14T03:00:00.000Z', 'HTTP 429 rate limit exceeded'),
    failed('r1', '2026-07-14T02:00:00.000Z', 'exit 1'),
    failed('r2', '2026-07-14T02:30:00.000Z', 'exit 1'),
  ];
  assert.equal(repoFailureStreak(jobs, 'r1'), 1); // 429 は無視、残る1件のみ
  assert.equal(repoFailureStreak(jobs, 'r2'), 1);
});

test('breakerDecision: 上限(3)到達でブロック・未満では通す', () => {
  const two = [failed('r1', '2026-07-14T02:00:00.000Z'), failed('r1', '2026-07-14T01:00:00.000Z')];
  const cur = { id: 'now', repo: 'r1' };
  const d1 = breakerDecision(two, cur, { code: 1, failReason: 'exit 1' });
  assert.equal(d1.block, true);          // 過去2 + 今回1 = 3 = limit
  assert.match(d1.reason, /3回連続失敗/);

  const one = [failed('r1', '2026-07-14T01:00:00.000Z')];
  const d2 = breakerDecision(one, cur, { code: 1, failReason: 'exit 1' });
  assert.equal(d2.block, false);         // 過去1 + 今回1 = 2 < 3
});

test('breakerDecision: 成功(code 0)と rate-limit はブロックしない', () => {
  const three = [
    failed('r1', '2026-07-14T03:00:00.000Z'),
    failed('r1', '2026-07-14T02:00:00.000Z'),
    failed('r1', '2026-07-14T01:00:00.000Z'),
  ];
  const cur = { id: 'now', repo: 'r1' };
  assert.equal(breakerDecision(three, cur, { code: 0 }).block, false);
  assert.equal(breakerDecision(three, cur, { code: 1, failReason: 'rate limit hit (429)' }).block, false);
});

test('breakerDecision: 判定中の当該ジョブ自身は streak に数えない(excludeId)', () => {
  const jobs = [
    { id: 'now', repo: 'r1', state: 'running', endedAt: null }, // まだ終わってない
    failed('r1', '2026-07-14T01:00:00.000Z'),
  ];
  const d = breakerDecision(jobs, { id: 'now', repo: 'r1' }, { code: 1, failReason: 'exit 1' });
  assert.equal(d.streak, 2); // 過去1 + 今回1（running の自分は除外）
  assert.equal(d.block, false);
});

test('isRateLimited: 代表的な文言を検出する', () => {
  for (const s of ['rate limit', 'HTTP 429', 'quota exceeded', 'model overloaded', 'Too Many Requests'])
    assert.equal(isRateLimited(s), true, s);
  assert.equal(isRateLimited('exit 1'), false);
  assert.equal(isRateLimited(null), false);
});
