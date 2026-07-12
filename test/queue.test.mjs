// キューのテスト: 投入・取り出し順・状態遷移・キャンセル境界を検証する。
// 実行: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueue, loadQueue, nextQueued, updateJob, countRunning, cancel } from '../lib/queue.mjs';

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
