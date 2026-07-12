import { spawn } from 'node:child_process';

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
  if (!job || !['done', 'failed', 'waiting_approval'].includes(job.state)) return null;

  const event = {
    type: job.state === 'waiting_approval' ? 'approval_waiting' : job.state,
    jobId: job.id,
    repo: job.repo,
    kind: job.kind,
  };
  if (job.state === 'failed' && job.failReason) event.failReason = job.failReason;
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
    : ['done', 'failed', 'budget_stop', 'approval_waiting'];
  if (!event || !enabled.includes(event.type)) return;

  const { title, body } = formatMessage(event);
  const attempts = [];
  if (cfg.toast) attempts.push(toast(title, body));
  if (cfg.webhookUrl) {
    const payload = { title, body, event };
    if (cfg.includeLogTail === true) payload.logTail = Array.isArray(logTail) ? logTail.slice(-20) : [];
    attempts.push(fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then((response) => {
      if (!response.ok) throw new Error(`webhook responded ${response.status}`);
    }));
  }

  const results = await Promise.allSettled(attempts);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) console.error(`2AIO notification failed: ${failure.reason?.message || failure.reason}`);
}
