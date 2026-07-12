// キューのテスト: 投入・取り出し順・状態遷移・キャンセル境界を検証する。
// 実行: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueue, loadQueue, nextQueued, updateJob, countRunning, cancel, reconcile, propagateSkips } from '../lib/queue.mjs';

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
