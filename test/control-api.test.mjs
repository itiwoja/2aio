import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// control.mjs reads these values when it is imported.  Configure the isolated
// registry and the harmless worker before the dynamic import below.
const root = fs.mkdtempSync(path.join(os.tmpdir(), '2aio-control-api-'));
const repoPath = path.join(root, 'repo');
fs.mkdirSync(repoPath);
const git = spawnSync('git', ['init'], { cwd: repoPath, encoding: 'utf8', windowsHide: true });
if (git.status !== 0) throw new Error(`git init failed: ${git.stderr}`);
fs.writeFileSync(path.join(root, 'repos.json'), JSON.stringify({
  repos: [{ id: 'repo', path: repoPath, state: 'ready', defaultLane: 'build' }],
}, null, 2));
process.env.AIO_CONTROL_ROOT = root;
process.env.AIO_WORKER_CMD = 'node -e setTimeout(()=>console.log(1),150)';
// Keep a real ccusage block from accidentally exercising the budget-stop path.
process.env.AIO_TOKEN_LIMIT = '1000000000000000';

const { server } = await import('../control.mjs');
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});

async function request(route, options) {
  return fetch(baseUrl + route, options);
}

async function job(id) {
  const response = await request(`/api/job?id=${encodeURIComponent(id)}`);
  assert.equal(response.status, 200);
  return response.json();
}

async function waitFor(id, predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  do {
    latest = await job(id);
    if (predicate(latest.job)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.fail(`job ${id} did not reach the expected state (last: ${latest.job.state})`);
}

test('enqueue は未登録 repo を 422 で拒否する', async () => {
  const response = await request('/api/enqueue?repo=nosuch&kind=build', { method: 'POST' });
  assert.equal(response.status, 422);
});

test('enqueue は cross-origin POST を 403 で拒否する', async () => {
  const response = await request('/api/enqueue?repo=repo&kind=build', {
    method: 'POST', headers: { Origin: 'http://evil.example' },
  });
  assert.equal(response.status, 403);
});

test('enqueue は worker を実行し、並行数上限で次の job を queued に保つ', async () => {
  const firstResponse = await request('/api/enqueue?repo=repo&kind=build', { method: 'POST' });
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.equal(first.ok, true);

  const running = await waitFor(first.job.id, (item) => item.state === 'running');
  assert.equal(running.job.startedAt !== null, true);

  const secondResponse = await request('/api/enqueue?repo=repo&kind=build', { method: 'POST' });
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();
  const queued = await job(second.job.id);
  assert.equal(queued.job.state, 'queued');

  const done = await waitFor(first.job.id, (item) => item.state === 'done');
  assert.equal(done.job.exit, 0);
  await waitFor(second.job.id, (item) => item.state === 'done');
});

test('job detail returns the job and worker log tail', async () => {
  const response = await request('/api/enqueue?repo=repo&kind=build', { method: 'POST' });
  const created = await response.json();
  const detail = await waitFor(created.job.id, (item) => item.state === 'done');
  assert.equal(detail.ok, true);
  assert.equal(detail.job.id, created.job.id);
  assert.ok(detail.logTail.some((line) => line.includes('1')), 'worker output is included in logTail');
});
