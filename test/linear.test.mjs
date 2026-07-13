import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectCompletion,
  filterUnseen,
  finalizeAction,
  loadSeen,
  mapIssueToJob,
  saveSeen,
} from '../lib/linear.mjs';

const repos = [{ id: 'my-app', path: '/tmp/my-app' }];
const issue = {
  id: 'issue-id', identifier: 'ENG-7', title: 'Add Linear intake', description: 'details',
  labels: ['repo:my-app', 'kind:build'],
};

test('mapIssueToJob maps a valid repo and kind label', () => {
  const result = mapIssueToJob(issue, repos);
  assert.equal(result.ok, true);
  assert.deepEqual(result.job, {
    repo: 'my-app', kind: 'build',
    args: { theme: 'Add Linear intake', detail: 'details', linearIssueId: 'issue-id', linearIdentifier: 'ENG-7' },
  });
});

test('mapIssueToJob reports missing, unknown, and invalid labels', () => {
  assert.equal(mapIssueToJob({ ...issue, labels: ['kind:build'] }, repos).reason, 'no-repo');
  assert.equal(mapIssueToJob({ ...issue, labels: ['repo:missing', 'kind:build'] }, repos).reason, 'unknown-repo');
  assert.equal(mapIssueToJob({ ...issue, labels: ['repo:my-app'] }, repos).reason, 'no-kind');
  assert.equal(mapIssueToJob({ ...issue, labels: ['repo:my-app', 'kind:fix'] }, repos).reason, 'no-kind');
});

test('filterUnseen removes IDs that were already handled', () => {
  assert.deepEqual(filterUnseen([{ id: 'a' }, { id: 'b' }], { ids: ['a'] }), [{ id: 'b' }]);
  assert.deepEqual(filterUnseen([{ id: 'a' }], { ids: [] }), [{ id: 'a' }]);
});

test('finalizeAction returns Linear state and tagged Japanese comment', () => {
  const failed = finalizeAction({ exit: 1, failReason: 'test failed', jobId: 'j1' });
  assert.equal(failed.state, 'Todo');
  assert.match(failed.comment, /^\[2aio-control job:j1\]/);
  const done = finalizeAction({ exit: 0, jobId: 'j2', completion: { completed: true, summary: 'all green' } });
  assert.equal(done.state, 'Done');
  const uncertain = finalizeAction({ exit: 0, jobId: 'j3', completion: { completed: false } });
  assert.equal(uncertain.state, null);
});

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), '2aio-linear-'));
}

test('detectCompletion uses the newest output directory report or completed state', () => {
  const root = tempRoot();
  const oldDir = path.join(root, 'output', 'old');
  const newest = path.join(root, 'output', 'new');
  fs.mkdirSync(oldDir, { recursive: true });
  fs.writeFileSync(path.join(oldDir, 'completion-report.md'), 'old report');
  fs.mkdirSync(newest, { recursive: true });
  fs.writeFileSync(path.join(newest, 'completion-report.md'), 'new report');
  const fromReport = detectCompletion(root);
  assert.equal(fromReport.completed, true);
  assert.equal(fromReport.summary, 'new report');

  fs.unlinkSync(path.join(newest, 'completion-report.md'));
  fs.writeFileSync(path.join(newest, 'state.md'), 'phase: completed\n');
  assert.deepEqual(detectCompletion(root), { completed: true });
  assert.deepEqual(detectCompletion(tempRoot()), { completed: false });
});

test('detectCompletion ignores artifacts older than since', () => {
  const root = tempRoot();
  const dir = path.join(root, 'output', 'proj');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'completion-report.md'), 'stale report');
  const future = Date.now() + 60_000;
  assert.deepEqual(detectCompletion(root, future), { completed: false });
  assert.equal(detectCompletion(root, Date.now() - 60_000).completed, true);
});

test('loadSeen defaults safely and saveSeen atomically keeps its newest 500 IDs', () => {
  const root = tempRoot();
  assert.deepEqual(loadSeen(root), { ids: [] });
  saveSeen(root, { ids: Array.from({ length: 501 }, (_, index) => `i${index}`) });
  const seen = loadSeen(root);
  assert.equal(seen.ids.length, 500);
  assert.equal(seen.ids[0], 'i1');
  assert.equal(fs.existsSync(path.join(root, 'control', 'linear-seen.json.tmp')), false);
});
