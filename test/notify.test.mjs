import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn as spawnChild } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import {
  budgetStopEvent, formatMessage, jobEvent, parseApprovalMarker,
  postWebhook, resolveWebhookTarget, sendNotification, validateWebhookUrl,
} from '../lib/notify.mjs';

test('parseApprovalMarker recognizes only an approval marker', () => {
  assert.deepEqual(parseApprovalMarker('[APPROVAL_WAITING] my-app'), { project: 'my-app' });
  assert.equal(parseApprovalMarker('[APPROVAL_WAITING]'), null);
  assert.equal(parseApprovalMarker('worker is still running'), null);
});

test('budgetStopEvent emits once per budget reset period', () => {
  const seen = new Set();
  const prev = { admit: true };
  const current = { admit: false, reason: 'budget', resetAt: '2026-07-12T10:00:00Z' };
  assert.deepEqual(budgetStopEvent(prev, current, seen), { type: 'budget_stop', resetAt: current.resetAt });
  assert.equal(budgetStopEvent(prev, current, seen), null);
  assert.equal(budgetStopEvent({ admit: false }, current, seen), null);
  assert.deepEqual(
    budgetStopEvent(prev, { ...current, resetAt: '2026-07-12T15:00:00Z' }, seen),
    { type: 'budget_stop', resetAt: '2026-07-12T15:00:00Z' },
  );
});

test('jobEvent and formatMessage handle terminal states', () => {
  const base = { id: 'job-1', repo: 'my-app', kind: 'implement' };
  assert.deepEqual(jobEvent({ ...base, state: 'done' }), { type: 'done', jobId: 'job-1', repo: 'my-app', kind: 'implement' });
  assert.deepEqual(jobEvent({ ...base, state: 'failed', failReason: 'exit 1' }), { type: 'failed', jobId: 'job-1', repo: 'my-app', kind: 'implement', failReason: 'exit 1' });
  assert.deepEqual(jobEvent({ ...base, state: 'waiting_approval' }), { type: 'approval_waiting', jobId: 'job-1', repo: 'my-app', kind: 'implement' });
  assert.equal(jobEvent({ ...base, state: 'running' }), null);
  assert.match(formatMessage({ type: 'approval_waiting', ...base }).body, /resume my-app/);
  const event = jobEvent({ id: 'j2', repo: 'app', kind: 'build', state: 'blocked', failReason: 'three failures' });
  assert.deepEqual(event, { type: 'blocked', jobId: 'j2', repo: 'app', kind: 'build', failReason: 'three failures' });
  assert.match(formatMessage(event).title, /blocked/i);
});

test('validateWebhookUrl requires public HTTPS and blocks non-public, metadata, and credential URLs', () => {
  assert.equal(validateWebhookUrl('https://hooks.example.com/x').ok, true);
  assert.equal(validateWebhookUrl('https://[2606:4700:4700::1111]/x').ok, true);
  for (const bad of [
    'http://hooks.example.com/x', 'https://user:password@hooks.example.com/x',
    'https://127.0.0.1/x', 'https://127.255.255.255/x', 'https://[::1]/x', 'https://[::ffff:127.0.0.1]/x',
    'https://0.0.0.0/x', 'https://10.0.0.1/x', 'https://172.31.255.255/x', 'https://192.168.1.10/x',
    'https://169.254.169.254/latest/meta-data/', 'https://192.0.2.1/x', 'https://198.51.100.1/x',
    'https://224.0.0.1/x', 'https://240.0.0.1/x',
    'https://[::]/x', 'https://[fe80::1]/x', 'https://[febf::ffff]/x',
    'https://[fd00:ec2::254]/x', 'https://[fd20:ce::254]/x', 'https://[ff00::1]/x',
    'https://[2001:2::1]/x', 'https://[2001:db8::1]/x', 'https://[2002:7f00:1::]/x',
    'https://[3ffe::1]/x', 'https://[3fff::1]/x',
    'https://metadata./x', 'https://metadata.google.internal./x', 'https://instance-data./x',
    'https://hooks.example.com/x#', 'file:///etc/passwd', 'gopher://x/', 'not a url',
  ]) assert.equal(validateWebhookUrl(bad).ok, false, `must reject ${bad}`);
});

test('resolveWebhookTarget resolves once, preserves validated answers, and rejects any non-public answer', async () => {
  let calls = 0;
  const target = await resolveWebhookTarget('https://hooks.example.com/x', async (host, options) => {
    calls += 1;
    assert.equal(host, 'hooks.example.com');
    assert.deepEqual(options, { all: true, verbatim: true });
    return [{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 }];
  });
  assert.equal(calls, 1);
  assert.deepEqual(target.addresses, [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ]);
  await assert.rejects(
    resolveWebhookTarget('https://hooks.example.com/x', async () => [
      { address: '93.184.216.34', family: 4 }, { address: 'fd20:ce::254', family: 6 },
    ]),
    /blocked address/,
  );
});

test('postWebhook connects through the supplied pinned address instead of resolving the hostname again', async () => {
  const received = [];
  const server = http.createServer((req, res) => { received.push(req.url); res.end('ok'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await postWebhook({
      url: new URL(`http://does-not-resolve.invalid:${server.address().port}/pinned`),
      addresses: [{ address: '127.0.0.1', family: 4 }],
    }, { event: 'pinned' });
    assert.deepEqual(received, ['/pinned']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('postWebhook bypasses built-in env proxies and connects only to a pinned address', async () => {
  let destinationRequests = 0;
  let proxyRequests = 0;
  const destination = http.createServer((_, res) => { destinationRequests += 1; res.end('ok'); });
  const proxy = http.createServer((_, res) => { proxyRequests += 1; res.end('proxy must not be used'); });
  await new Promise((resolve) => destination.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const moduleUrl = new URL('../lib/notify.mjs', import.meta.url).href;
    const webhookUrl = `http://does-not-resolve.invalid:${destination.address().port}/pinned`;
    const source = [
      `import { postWebhook } from ${JSON.stringify(moduleUrl)};`,
      `await postWebhook({ url: new URL(${JSON.stringify(webhookUrl)}), addresses: [{ address: '127.0.0.1', family: 4 }] }, { event: 'proxy-bypass' });`,
    ].join('\n');
    const child = spawnChild(process.execPath, ['--input-type=module', '--eval', source], {
      env: {
        ...process.env,
        NODE_USE_ENV_PROXY: '1',
        HTTP_PROXY: `http://127.0.0.1:${proxy.address().port}`,
        HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`,
        NO_PROXY: '',
        http_proxy: `http://127.0.0.1:${proxy.address().port}`,
        https_proxy: `http://127.0.0.1:${proxy.address().port}`,
        no_proxy: '',
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const [code] = await once(child, 'close');
    assert.equal(code, 0, stderr);
    assert.equal(destinationRequests, 1);
    assert.equal(proxyRequests, 0);
  } finally {
    await new Promise((resolve) => destination.close(resolve));
    await new Promise((resolve) => proxy.close(resolve));
  }
});

test('postWebhook times out a peer that never responds', async () => {
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(postWebhook({
      url: new URL(`http://hung.invalid:${server.address().port}/hook`),
      addresses: [{ address: '127.0.0.1', family: 4 }],
    }, { event: 'timeout' }, { timeoutMs: 30 }), /timed out/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('postWebhook settles from response headers without waiting for an untrusted body', async () => {
  const server = http.createServer((_, response) => {
    response.writeHead(200, { 'content-length': '100' });
    response.write('x');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let deadline;
  try {
    await Promise.race([
      postWebhook({
        url: new URL(`http://partial-body.invalid:${server.address().port}/hook`),
        addresses: [{ address: '127.0.0.1', family: 4 }],
      }, { event: 'partial-body' }, { timeoutMs: 500 }),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('response body caused a hang')), 2_000); }),
    ]);
  } finally {
    clearTimeout(deadline);
    await new Promise((resolve) => server.close(resolve));
  }
});

test('sendNotification does not connect to a loopback URL without the local opt-in', async () => {
  let requests = 0;
  const server = http.createServer((_, res) => { requests += 1; res.end('unexpected'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.AIO_LOCAL_WEBHOOK_URL;
  delete process.env.AIO_LOCAL_WEBHOOK_URL;
  try {
    await sendNotification({ webhookUrl: `http://127.0.0.1:${server.address().port}/blocked`, toast: false }, { type: 'done', repo: 'app', kind: 'build' });
    assert.equal(requests, 0);
  } finally {
    if (previous !== undefined) process.env.AIO_LOCAL_WEBHOOK_URL = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('sendNotification redacts payloads sent through an exact local relay opt-in', async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { received.push(body); res.end('ok'); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const webhookUrl = `http://127.0.0.1:${server.address().port}/hook`;
  const previous = process.env.AIO_LOCAL_WEBHOOK_URL;
  process.env.AIO_LOCAL_WEBHOOK_URL = webhookUrl;
  const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
  try {
    await sendNotification({ webhookUrl, toast: false }, { type: 'failed', repo: 'app', kind: 'build', failReason: secret });
    assert.equal(received.length, 1);
    assert.ok(!received[0].includes(secret));
    assert.ok(received[0].includes('[REDACTED]'));
  } finally {
    if (previous === undefined) delete process.env.AIO_LOCAL_WEBHOOK_URL;
    else process.env.AIO_LOCAL_WEBHOOK_URL = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('local relay needs an exact parent-process opt-in and never follows redirects', async () => {
  let redirectTargetRequests = 0;
  const target = http.createServer((_, res) => { redirectTargetRequests += 1; res.end('unexpected'); });
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  const relay = http.createServer((_, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${target.address().port}/private` });
    res.end();
  });
  await new Promise((resolve) => relay.listen(0, '127.0.0.1', resolve));
  const relayUrl = `http://127.0.0.1:${relay.address().port}/relay?channel=ops`;
  const previous = process.env.AIO_LOCAL_WEBHOOK_URL;
  process.env.AIO_LOCAL_WEBHOOK_URL = relayUrl;
  try {
    await sendNotification({ webhookUrl: relayUrl, toast: false }, { type: 'done', repo: 'app', kind: 'build' });
    assert.equal(redirectTargetRequests, 0);
    assert.equal(validateWebhookUrl(`${relayUrl}#fragment`).ok, false);
    assert.equal(validateWebhookUrl(`${relayUrl}#`).ok, false);
    assert.equal(validateWebhookUrl(`http://127.0.0.1:${relay.address().port}/other`).ok, false);
  } finally {
    if (previous === undefined) delete process.env.AIO_LOCAL_WEBHOOK_URL;
    else process.env.AIO_LOCAL_WEBHOOK_URL = previous;
    await new Promise((resolve) => relay.close(resolve));
    await new Promise((resolve) => target.close(resolve));
  }
});

test('local relay opt-in never permits a LAN host', () => {
  const previous = process.env.AIO_LOCAL_WEBHOOK_URL;
  const lanRelay = 'http://192.168.1.10:8080/hook';
  process.env.AIO_LOCAL_WEBHOOK_URL = lanRelay;
  try {
    assert.equal(validateWebhookUrl(lanRelay).ok, false);
  } finally {
    if (previous === undefined) delete process.env.AIO_LOCAL_WEBHOOK_URL;
    else process.env.AIO_LOCAL_WEBHOOK_URL = previous;
  }
});

test('local relay opt-in still rejects unsupported schemes', () => {
  const previous = process.env.AIO_LOCAL_WEBHOOK_URL;
  process.env.AIO_LOCAL_WEBHOOK_URL = 'gopher://127.0.0.1/hook';
  try {
    assert.equal(validateWebhookUrl(process.env.AIO_LOCAL_WEBHOOK_URL).ok, false);
  } finally {
    if (previous === undefined) delete process.env.AIO_LOCAL_WEBHOOK_URL;
    else process.env.AIO_LOCAL_WEBHOOK_URL = previous;
  }
});

test('webhook errors are fail-open and never log a response body', async () => {
  const responseSecret = 'response-body-must-not-leak';
  const server = http.createServer((_, res) => { res.writeHead(500); res.end(responseSecret); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const webhookUrl = `http://127.0.0.1:${server.address().port}/hook`;
  const previousUrl = process.env.AIO_LOCAL_WEBHOOK_URL;
  const previousError = console.error;
  const logs = [];
  process.env.AIO_LOCAL_WEBHOOK_URL = webhookUrl;
  console.error = (...args) => { logs.push(args.join(' ')); };
  try {
    await sendNotification({ webhookUrl, toast: false }, { type: 'done', repo: 'app', kind: 'build' });
    assert.ok(logs.some((line) => line.includes('2AIO notification failed')));
    assert.ok(logs.every((line) => !line.includes(responseSecret)));
  } finally {
    console.error = previousError;
    if (previousUrl === undefined) delete process.env.AIO_LOCAL_WEBHOOK_URL;
    else process.env.AIO_LOCAL_WEBHOOK_URL = previousUrl;
    await new Promise((resolve) => server.close(resolve));
  }
});
