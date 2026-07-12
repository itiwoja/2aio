// ガバナーのテスト: サブスク共有枠を食い潰さない入場判定が破られないことを保証する。
// 実行: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admitJob, usedFraction } from '../lib/governor.mjs';

const LIMIT = 220_000_000;

test('枠に余裕・実行なし → 投入可', () => {
  const r = admitJob({ active: { tokens: 1_000_000 }, tokenLimit: LIMIT, threshold: 0.8, running: 0, maxConcurrency: 1 });
  assert.equal(r.admit, true);
  assert.equal(r.reason, 'ok');
});

test('使用率が閾値以上 → 予算で停止し reset時刻を返す', () => {
  const r = admitJob({ active: { tokens: 200_000_000, end: '2026-07-07T12:00:00Z' }, tokenLimit: LIMIT, threshold: 0.8, running: 0, maxConcurrency: 1 });
  assert.equal(r.admit, false);
  assert.equal(r.reason, 'budget');
  assert.equal(r.resetAt, '2026-07-07T12:00:00Z');
});

test('同時実行上限に達していれば枠に余裕でも停止', () => {
  const r = admitJob({ active: { tokens: 0 }, tokenLimit: LIMIT, threshold: 0.8, running: 1, maxConcurrency: 1 });
  assert.equal(r.admit, false);
  assert.equal(r.reason, 'concurrency');
});

test('同時実行上限が予算閾値より優先される', () => {
  const r = admitJob({ active: { tokens: 210_000_000 }, tokenLimit: LIMIT, threshold: 0.8, running: 2, maxConcurrency: 1 });
  assert.equal(r.reason, 'concurrency');
});

test('ccusage未取得(active=null)なら予算では止めない（同時実行のみで判定）', () => {
  const r = admitJob({ active: null, tokenLimit: LIMIT, threshold: 0.8, running: 0, maxConcurrency: 1 });
  assert.equal(r.admit, true);
  assert.equal(r.usedPct, null);
});

test('tokenLimit不明(0)でも予算では止めない', () => {
  const r = admitJob({ active: { tokens: 999 }, tokenLimit: 0, threshold: 0.8, running: 0, maxConcurrency: 1 });
  assert.equal(r.admit, true);
  assert.equal(r.usedPct, null);
});

test('maxConcurrency>1 なら空きがある限り投入可', () => {
  const r = admitJob({ active: { tokens: 0 }, tokenLimit: LIMIT, threshold: 0.8, running: 1, maxConcurrency: 3 });
  assert.equal(r.admit, true);
});

test('usedFraction: 使用率を正しく計算 / 不明時は null', () => {
  assert.equal(usedFraction({ active: { tokens: 110_000_000 }, tokenLimit: LIMIT }), 0.5);
  assert.equal(usedFraction({ active: null, tokenLimit: LIMIT }), null);
  assert.equal(usedFraction({ active: { tokens: 1 }, tokenLimit: 0 }), null);
});
