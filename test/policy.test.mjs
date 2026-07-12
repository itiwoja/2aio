// 安全分岐のテスト: README の安全設計が破られないことを保証する
// 実行: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { decideAction } from '../lib/policy.mjs';
import { within, resolvePaths } from '../lib/paths.mjs';

test('vault × low × 監査PASS × dryでない → 自動適用', () => {
  const r = decideAction({ targetType: 'vault', risk: 'low', auditPass: true, dry: false });
  assert.equal(r.action, 'apply');
});

test('skill は監査PASSでも絶対に自動適用されない', () => {
  const r = decideAction({ targetType: 'skill', risk: 'low', auditPass: true, dry: false });
  assert.equal(r.action, 'propose');
});

test('high リスクは vault でも自動適用されない', () => {
  const r = decideAction({ targetType: 'vault', risk: 'high', auditPass: true, dry: false });
  assert.equal(r.action, 'propose');
});

test('監査NG は自動適用されない', () => {
  const r = decideAction({ targetType: 'vault', risk: 'low', auditPass: false, dry: false });
  assert.equal(r.action, 'propose');
});

test('監査結果が不正値(undefined等)でも自動適用されない', () => {
  for (const auditPass of [undefined, null, 'true', 1]) {
    const r = decideAction({ targetType: 'vault', risk: 'low', auditPass, dry: false });
    assert.equal(r.action, 'propose', `auditPass=${String(auditPass)}`);
  }
});

test('--dry は全条件成立でも提案のみ', () => {
  const r = decideAction({ targetType: 'vault', risk: 'low', auditPass: true, dry: true });
  assert.equal(r.action, 'propose');
});

test('within: 配下は許可・外/親/同一パスは拒否', () => {
  const base = 'C:/Users/x/vault';
  assert.equal(within('C:/Users/x/vault/knowledge/a.md', base), true);
  assert.equal(within('C:/Users/x/vault', base), false);
  assert.equal(within('C:/Users/x/other/a.md', base), false);
  assert.equal(within('C:/Users/x/vault/../secrets.md', base), false);
});

test('resolvePaths: 相対はroot基準・絶対はそのまま', () => {
  // プラットフォーム依存を避ける: 'C:/...' は Linux では絶対パスでないため（CI=ubuntu で発覚）、
  // 実行環境ネイティブの絶対パスで検証する
  const root = path.resolve('/repo');
  const abs = path.resolve('/users/x/vault');
  const r = resolvePaths(root, { proposals: 'proposals', vault: abs });
  assert.equal(path.normalize(r.proposals), path.join(root, 'proposals'));
  assert.equal(path.normalize(r.vault), path.normalize(abs));
});
