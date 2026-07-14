import { spawn } from 'node:child_process';
import { redactSecrets, redactObject } from './redact.mjs';

// webhook URL の最小 SSRF ガード。webhookUrl は config 由来（本来 trusted）だが、poisoned repo /
// worker が config を書き換えて内部プローブやクラウドメタデータ流出に悪用する経路を塞ぐ。
// 方針: scheme を http/https に限定し、リンクローカル(169.254/16 = AWS/GCP/Azure メタデータ・
// IPv6 fe80::)とメタデータ hostname を拒否。ループバック/プライベートは自前リレー用途で許可する
// （ペイロードは送信前に墨消し済み）。DNS 解決はしない（host リテラルのみ検査。限界は SECURITY.md）。
const BLOCKED_WEBHOOK_HOSTS = new Set(['metadata.google.internal', 'metadata']);

/** webhook URL を検査し { ok, reason } を返す（fetch 前ゲート）。 */
export function validateWebhookUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return { ok: false, reason: 'invalid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: `unsupported scheme ${u.protocol}` };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_WEBHOOK_HOSTS.has(host)) return { ok: false, reason: 'metadata host blocked' };
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return { ok: false, reason: 'link-local address blocked' };
  if (/^fe80:/i.test(host)) return { ok: false, reason: 'link-local address blocked' };
  return { ok: true };
}

/** Parse a worker line that asks the control plane for approval. */
export function parseApprovalMarker(line) {
  if (typeof line !== 'string') return null;
  const match = line.match(/^\[APPROVAL_WAITING\]\s+(.+?)\s*$/);
  return match && match[1].trim() ? { project: match[1].trim() } : null;
}

/**
 * Emit one event when the governor first starts rejecting work for budget.
 * The reset time identifies a single budget-block period.
 */
export function budgetStopEvent(prev, cur, seen) {
  if (!prev?.admit || cur?.admit || cur?.reason !== 'budget') return null;

  const resetAt = cur.resetAt ?? null;
  if (seen?.has(resetAt)) return null;
  seen?.add(resetAt);
  return { type: 'budget_stop', resetAt };
}

/** Convert terminal and approval-waiting jobs into notification events. */
export function jobEvent(job) {
  if (!job || !['done', 'failed', 'waiting_approval', 'blocked'].includes(job.state)) return null;

  const event = {
    type: job.state === 'waiting_approval' ? 'approval_waiting' : job.state,
    jobId: job.id,
    repo: job.repo,
    kind: job.kind,
  };
  if ((job.state === 'failed' || job.state === 'blocked') && job.failReason) event.failReason = job.failReason;
  return event;
}

/** Produce a concise human-readable notification from an event. */
export function formatMessage(event) {
  const repo = event?.repo || 'unknown repository';
  const kind = event?.kind || 'job';
  const jobId = event?.jobId ? ` (${event.jobId})` : '';

  switch (event?.type) {
    case 'done':
      return { title: '2AIO job completed', body: `${repo}: ${kind}${jobId} completed.` };
    case 'failed':
      return {
        title: '2AIO job failed',
        body: `${repo}: ${kind}${jobId} failed${event.failReason ? `: ${event.failReason}` : '.'}`,
      };
    case 'approval_waiting':
      return {
        title: '2AIO approval required',
        body: `${repo}: ${kind}${jobId} is waiting for approval. To continue, run: resume ${repo}`,
      };
    case 'blocked':
      return {
        title: '2AIO job blocked',
        body: `${repo}: ${kind}${jobId} blocked after repeated failures${event.failReason ? `: ${event.failReason}` : '.'}`,
      };
    case 'budget_stop':
      return {
        title: '2AIO budget limit reached',
        body: event.resetAt ? `New jobs will resume after ${event.resetAt}.` : 'New jobs are paused by the budget governor.',
      };
    default:
      return { title: '2AIO notification', body: '' };
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
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true });
    } catch (error) {
      reject(error);
      return;
    }
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`toast process exited with code ${code}`));
    });
  });
}

/** Send the configured local toast and/or webhook notification without throwing. */
export async function sendNotification(cfg = {}, event, logTail = []) {
  const enabled = Array.isArray(cfg.events)
    ? cfg.events
    : ['done', 'failed', 'budget_stop', 'approval_waiting', 'blocked'];
  if (!event || !enabled.includes(event.type)) return;

  // 通知は機外(webhook)・UI(toast)へ出る面なので、送信前に必ず墨消しする(バックストップ)。
  const raw = formatMessage(event);
  const title = redactSecrets(raw.title);
  const body = redactSecrets(raw.body);
  const attempts = [];
  if (cfg.toast) attempts.push(toast(title, body));
  if (cfg.webhookUrl) {
    const check = validateWebhookUrl(cfg.webhookUrl);
    if (!check.ok) {
      console.error(`2AIO webhook skipped: ${check.reason}`);
    } else {
      const payload = { title, body, event: redactObject(event) };
      if (cfg.includeLogTail === true) payload.logTail = (Array.isArray(logTail) ? logTail.slice(-20) : []).map(redactSecrets);
      attempts.push(fetch(cfg.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'error', // public→内部への redirect ピボット SSRF を防ぐ（追従しない）
      }).then((response) => {
        if (!response.ok) throw new Error(`webhook responded ${response.status}`);
      }));
    }
  }

  const results = await Promise.allSettled(attempts);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) console.error(`2AIO notification failed: ${failure.reason?.message || failure.reason}`);
}
