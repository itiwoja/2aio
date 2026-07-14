import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { budgetStopEvent, formatMessage, jobEvent, parseApprovalMarker, sendNotification, validateWebhookUrl } from '../lib/notify.mjs';

test('parseApprovalMarker recognizes an approval marker only', () => {
  assert.deepEqual(parseApprovalMarker('[APPROVAL_WAITING] my-app'), { project: 'my-app' });
  assert.equal(parseApprovalMarker('[APPROVAL_WAITING]'), null);
  assert.equal(parseApprovalMarker('worker is still running'), null);
});

test('budgetStopEvent emits once for each budget reset period', () => {
  const seen = new Set();
  const prev = { admit: true, reason: 'ok', resetAt: '2026-07-12T10:00:00Z' };
  const cur = { admit: false, reason: 'budget', resetAt: '2026-07-12T10:00:00Z' };

  assert.deepEqual(budgetStopEvent(prev, cur, seen), { type: 'budget_stop', resetAt: cur.resetAt });
  assert.equal(budgetStopEvent(prev, cur, seen), null);
  assert.equal(budgetStopEvent({ admit: false }, cur, seen), null);
  assert.deepEqual(
    budgetStopEvent(prev, { ...cur, resetAt: '2026-07-12T15:00:00Z' }, seen),
    { type: 'budget_stop', resetAt: '2026-07-12T15:00:00Z' },
  );
});

test('jobEvent maps terminal and approval-waiting states', () => {
  const base = { id: 'job-1', repo: 'my-app', kind: 'implement' };
  assert.deepEqual(jobEvent({ ...base, state: 'done' }), { type: 'done', jobId: 'job-1', repo: 'my-app', kind: 'implement' });
  assert.deepEqual(jobEvent({ ...base, state: 'failed', failReason: 'exit 1' }), {
    type: 'failed', jobId: 'job-1', repo: 'my-app', kind: 'implement', failReason: 'exit 1',
  });
  assert.deepEqual(jobEvent({ ...base, state: 'waiting_approval' }), {
    type: 'approval_waiting', jobId: 'job-1', repo: 'my-app', kind: 'implement',
  });
  assert.equal(jobEvent({ ...base, state: 'running' }), null);
});

test('formatMessage tells an approval-waiting project how to resume', () => {
  const message = formatMessage({ type: 'approval_waiting', jobId: 'job-1', repo: 'my-app', kind: 'implement' });
  assert.match(message.body, /resume my-app/);
});

test('jobEvent / formatMessage handle the blocked state', () => {
  const ev = jobEvent({ id: 'j2', repo: 'app', kind: 'build', state: 'blocked', failReason: '3回連続失敗のため blocked' });
  assert.deepEqual(ev, { type: 'blocked', jobId: 'j2', repo: 'app', kind: 'build', failReason: '3回連続失敗のため blocked' });
  assert.match(formatMessage(ev).title, /blocked/i);
});

test('sendNotification redacts secrets in the webhook payload (機外に漏らさない)', async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { received.push(b); res.end('ok'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
  const event = { type: 'failed', jobId: 'j', repo: 'app', kind: 'build', failReason: `boom leaked ${secret}` };
  try {
    await sendNotification({ webhookUrl: `http://127.0.0.1:${port}/hook`, toast: false }, event);
  } finally {
    await new Promise((r) => server.close(r));
  }
  assert.equal(received.length, 1);
  assert.ok(!received[0].includes(secret), `秘密が webhook に漏れた: ${received[0]}`);
  assert.ok(received[0].includes('[REDACTED]'));
});

test('validateWebhookUrl: 内部/メタデータ/不正 scheme を拒否し、通常 URL とループバックは許可', () => {
  // 許可（自前リレー用途でループバック/プライベートは通す）
  for (const ok of ['https://hooks.example.com/x', 'http://127.0.0.1:8080/hook', 'http://192.168.1.10/n']) {
    assert.equal(validateWebhookUrl(ok).ok, true, `許可されるべき: ${ok}`);
  }
  // 拒否（クラウドメタデータ・リンクローカル・非 http scheme・不正）
  for (const bad of ['http://169.254.169.254/latest/meta-data/', 'http://metadata.google.internal/x', 'file:///etc/passwd', 'gopher://x/', 'not a url']) {
    assert.equal(validateWebhookUrl(bad).ok, false, `拒否されるべき: ${bad}`);
  }
});

test('sendNotification: ブロック対象 URL には送信しない（fetch を試みない）', async () => {
  const originalFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async () => { called += 1; return { ok: true }; };
  try {
    await sendNotification({ webhookUrl: 'http://169.254.169.254/exfil', toast: false }, { type: 'done', repo: 'app', kind: 'build' });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(called, 0, 'ブロック対象 URL に fetch してしまった');
});
