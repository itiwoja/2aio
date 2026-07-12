import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetStopEvent, formatMessage, jobEvent, parseApprovalMarker } from '../lib/notify.mjs';

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
