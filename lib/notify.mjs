import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { redactSecrets, redactObject } from './redact.mjs';

const BLOCKED_WEBHOOK_HOSTS = new Set([
  'metadata', 'metadata.google.internal', 'instance-data',
]);

const hostnameOf = (url) => url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');

const IPV4 = (address) => address.split('.').reduce((value, part) => (value * 256) + Number(part), 0);
const IPV4_CIDR = (address, base, bits) => {
  const shift = 32 - bits;
  return (IPV4(address) >>> shift) === (IPV4(base) >>> shift);
};

function ipv6ToBigInt(address) {
  let input = String(address).replace(/^\[|\]$/g, '').toLowerCase();
  const tail = input.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (tail) {
    const value = IPV4(tail[1]);
    input = input.slice(0, input.length - tail[1].length) + `${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const parts = input.split('::');
  if (parts.length > 2) throw new Error('invalid IPv6 address');
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) throw new Error('invalid IPv6 address');
  return groups.reduce((value, group) => (value << 16n) + BigInt(`0x${group}`), 0n);
}

const IPV6_SPECIAL_RANGES = [
  ['2001::', 23],       // IETF protocol assignments (includes benchmark/ORCHID ranges)
  ['2001:db8::', 32],   // documentation
  ['2002::', 16],       // deprecated 6to4 transition space
  ['3ffe::', 16],       // retired 6bone space
  ['3fff::', 20],       // documentation
].map(([base, bits]) => [ipv6ToBigInt(base), BigInt(128 - bits)]);

function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    return ![
      ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
      ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
      ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
      ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
    ].some(([base, bits]) => IPV4_CIDR(address, base, bits));
  }
  if (family !== 6) return false;
  const value = ipv6ToBigInt(address);
  const ipv4Mapped = value >> 32n === 0xffffn;
  if (ipv4Mapped) {
    const mapped = Number(value & 0xffffffffn);
    return isPublicAddress([mapped >>> 24, (mapped >>> 16) & 255, (mapped >>> 8) & 255, mapped & 255].join('.'));
  }
  const globalUnicastStart = 0x2000n << 112n;
  const globalUnicastEnd = 0x4000n << 112n;
  return value >= globalUnicastStart && value < globalUnicastEnd
    && !IPV6_SPECIAL_RANGES.some(([base, shift]) => (value >> shift) === (base >> shift));
}

function canonicalUrl(raw) {
  const text = String(raw);
  const url = new URL(text);
  if (text.includes('#')) throw new Error('fragments are not permitted');
  if (url.username || url.password) throw new Error('URL userinfo is not permitted');
  return url;
}

function isExactLocalRelay(url) {
  const configured = process.env.AIO_LOCAL_WEBHOOK_URL;
  if (!configured) return false;
  let allowed;
  try { allowed = canonicalUrl(configured); } catch { return false; }
  const host = hostnameOf(url);
  return (host === '127.0.0.1' || host === '::1') && url.href === allowed.href;
}

/** Validate the URL's syntax and literal-address policy before DNS resolution. */
export function validateWebhookUrl(raw) {
  let url;
  try { url = canonicalUrl(raw); } catch (error) { return { ok: false, reason: error.message || 'invalid URL' }; }
  const host = hostnameOf(url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: `unsupported scheme ${url.protocol}` };
  if (isExactLocalRelay(url)) return { ok: true, localRelay: true, url };
  if (url.protocol !== 'https:') return { ok: false, reason: 'public webhooks require HTTPS' };
  if (BLOCKED_WEBHOOK_HOSTS.has(host)) return { ok: false, reason: 'metadata host blocked' };
  if (isIP(host) && !isPublicAddress(host)) return { ok: false, reason: 'non-public address blocked' };
  return { ok: true, url };
}

/** Resolve once, validate every result, and return the pinned addresses for the HTTP request. */
export async function resolveWebhookTarget(raw, lookup = dnsLookup) {
  const checked = validateWebhookUrl(raw);
  if (!checked.ok) throw new Error(checked.reason);
  const { url } = checked;
  const host = hostnameOf(url);
  const literalFamily = isIP(host);
  const answers = literalFamily
    ? [{ address: host, family: literalFamily }]
    : await lookup(host, { all: true, verbatim: true });
  if (!Array.isArray(answers) || answers.length === 0) throw new Error('hostname did not resolve');
  const addresses = answers.map((answer) => ({ address: answer.address, family: Number(answer.family) || isIP(answer.address) }));
  if (!checked.localRelay && addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('blocked address returned by DNS');
  return { url, addresses };
}

export function postWebhook({ url, addresses }, payload, { timeoutMs = 10_000 } = {}) {
  const transport = url.protocol === 'https:' ? https : http;
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    let timeout;
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const request = transport.request(url, {
      method: 'POST',
      agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      lookup: (_, options, callback) => {
        const requestedFamily = typeof options === 'number' ? options : Number(options?.family) || 0;
        const candidates = requestedFamily
          ? addresses.filter(({ family }) => family === requestedFamily)
          : addresses;
        if (candidates.length === 0) {
          callback(new Error(`no validated IPv${requestedFamily} webhook address`));
        } else if (typeof options === 'object' && options?.all) {
          callback(null, candidates.map(({ address, family }) => ({ address, family })));
        } else {
          callback(null, candidates[0].address, candidates[0].family);
        }
      },
    }, (response) => {
      const statusCode = response.statusCode;
      response.destroy();
      if (statusCode >= 200 && statusCode < 300) settle(resolve);
      else settle(reject, new Error(`webhook responded ${statusCode}`));
    });
    request.once('error', (error) => settle(reject, error));
    timeout = setTimeout(() => request.destroy(new Error('webhook request timed out')), timeoutMs);
    timeout.unref?.();
    request.end(body);
  });
}

/** Parse a worker line that asks the control plane for approval. */
export function parseApprovalMarker(line) {
  if (typeof line !== 'string') return null;
  const match = line.match(/^\[APPROVAL_WAITING\]\s+(.+?)\s*$/);
  return match && match[1].trim() ? { project: match[1].trim() } : null;
}

export function budgetStopEvent(prev, cur, seen) {
  if (!prev?.admit || cur?.admit || cur?.reason !== 'budget') return null;
  const resetAt = cur.resetAt ?? null;
  if (seen?.has(resetAt)) return null;
  seen?.add(resetAt);
  return { type: 'budget_stop', resetAt };
}

export function jobEvent(job) {
  if (!job || !['done', 'failed', 'waiting_approval', 'blocked'].includes(job.state)) return null;
  const event = { type: job.state === 'waiting_approval' ? 'approval_waiting' : job.state, jobId: job.id, repo: job.repo, kind: job.kind };
  if ((job.state === 'failed' || job.state === 'blocked') && job.failReason) event.failReason = job.failReason;
  return event;
}

export function formatMessage(event) {
  const repo = event?.repo || 'unknown repository';
  const kind = event?.kind || 'job';
  const jobId = event?.jobId ? ` (${event.jobId})` : '';
  switch (event?.type) {
    case 'done': return { title: '2AIO job completed', body: `${repo}: ${kind}${jobId} completed.` };
    case 'failed': return { title: '2AIO job failed', body: `${repo}: ${kind}${jobId} failed${event.failReason ? `: ${event.failReason}` : '.'}` };
    case 'approval_waiting': return { title: '2AIO approval required', body: `${repo}: ${kind}${jobId} is waiting for approval. To continue, run: resume ${repo}` };
    case 'blocked': return { title: '2AIO job blocked', body: `${repo}: ${kind}${jobId} blocked after repeated failures${event.failReason ? `: ${event.failReason}` : '.'}` };
    case 'budget_stop': return { title: '2AIO budget limit reached', body: event.resetAt ? `New jobs will resume after ${event.resetAt}.` : 'New jobs are paused by the budget governor.' };
    default: return { title: '2AIO notification', body: '' };
  }
}

const psQuote = (value) => String(value).replace(/'/g, "''");

function toast(title, body) {
  const clippedTitle = String(title).slice(0, 200);
  const clippedBody = String(body).slice(0, Math.max(0, 200 - clippedTitle.length));
  const script = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
    '$template = [Windows.UI.Notifications.ToastTemplateType]::ToastText02',
    '$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template)',
    '$text = $xml.GetElementsByTagName("text")',
    `$text.Item(0).AppendChild($xml.CreateTextNode('${psQuote(clippedTitle)}')) > $null`,
    `$text.Item(1).AppendChild($xml.CreateTextNode('${psQuote(clippedBody)}')) > $null`,
    '$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)',
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("2AIO").Show($toast)',
  ].join('; ');
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true }); }
    catch (error) { reject(error); return; }
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? resolve() : reject(new Error(`toast process exited with code ${code}`))));
  });
}

/** Send configured notifications without allowing notification failure to interrupt control-plane work. */
export async function sendNotification(cfg = {}, event, logTail = []) {
  const enabled = Array.isArray(cfg.events) ? cfg.events : ['done', 'failed', 'budget_stop', 'approval_waiting', 'blocked'];
  if (!event || !enabled.includes(event.type)) return;
  const raw = formatMessage(event);
  const title = redactSecrets(raw.title);
  const body = redactSecrets(raw.body);
  const attempts = [];
  if (cfg.toast) attempts.push(toast(title, body));
  if (cfg.webhookUrl) {
    try {
      const target = await resolveWebhookTarget(cfg.webhookUrl);
      const payload = { title, body, event: redactObject(event) };
      if (cfg.includeLogTail === true) payload.logTail = (Array.isArray(logTail) ? logTail.slice(-20) : []).map(redactSecrets);
      attempts.push(postWebhook(target, payload));
    } catch { console.error('2AIO webhook skipped by security policy'); }
  }
  const results = await Promise.allSettled(attempts);
  if (results.some((result) => result.status === 'rejected')) console.error('2AIO notification failed');
}
