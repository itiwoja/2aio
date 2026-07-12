// #17 予算安全弁の回帰テスト — ccusage スキーマドリフトで tokens=0 が返ると
// ガバナーが「使用率0%」として無制限 admit する故障モード（実事故 e7518b3）を固定する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockTokens, pickActiveBlock } from '../lib/ccusage.mjs';

// ---- blockTokens: バージョン差フィクスチャ ----

test('blockTokens: totalTokens 版 (新スキーマ) を優先する', () => {
  assert.equal(blockTokens({ totalTokens: 1234, tokenCounts: { inputTokens: 1 } }), 1234);
});

test('blockTokens: tokenCounts 版 (旧スキーマ) は4系列を合算する', () => {
  const b = { tokenCounts: { inputTokens: 100, outputTokens: 200, cacheCreationInputTokens: 30, cacheReadInputTokens: 4 } };
  assert.equal(blockTokens(b), 334);
});

test('blockTokens: tokens フィールド版にもフォールバックする', () => {
  assert.equal(blockTokens({ tokens: { inputTokens: 5, outputTokens: 7 } }), 12);
});

test('blockTokens: 未知スキーマ (どのフィールドも無い) は 0 — この 0 がガバナー無効化の入口である事実を固定', () => {
  assert.equal(blockTokens({}), 0);
});

test('blockTokens: totalTokens が数値でない場合は合算経路に落ちる', () => {
  assert.equal(blockTokens({ totalTokens: '9999', tokenCounts: { inputTokens: 42 } }), 42);
});

// ---- pickActiveBlock: 3段フォールバック ----

test('pickActiveBlock: isActive を最優先で拾う', () => {
  const arr = [{ id: 'gap', isGap: true }, { id: 'a' }, { id: 'b', isActive: true }];
  assert.equal(pickActiveBlock(arr).id, 'b');
});

test('pickActiveBlock: isActive 欠落版は gap でない最初のブロック', () => {
  const arr = [{ id: 'gap', isGap: true }, { id: 'a' }, { id: 'b' }];
  assert.equal(pickActiveBlock(arr).id, 'a');
});

test('pickActiveBlock: 全部 gap なら先頭にフォールバック', () => {
  const arr = [{ id: 'g1', isGap: true }, { id: 'g2', isGap: true }];
  assert.equal(pickActiveBlock(arr).id, 'g1');
});

test('pickActiveBlock: 空 blocks → null (governor 側の意図的 fail-open に渡る)', () => {
  assert.equal(pickActiveBlock([]), null);
});

test('pickActiveBlock: パース不能 (配列でない) → null', () => {
  assert.equal(pickActiveBlock(null), null);
  assert.equal(pickActiveBlock(undefined), null);
  assert.equal(pickActiveBlock({ blocks: 'oops' }), null);
});
