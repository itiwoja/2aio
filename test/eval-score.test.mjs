// #25 eval ハーネスの採点ロジック回帰テスト（scoreProject は純粋なファイル採点なので直接テスト可能）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scoreProject } from '../eval/run-eval.mjs';

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2aio-eval-'));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

const CLEAN_STATE = '---\nproject: x\ntasks_failed: 0\n---\n';

test('成果物なし → NO_ARTIFACT・全指標 null', () => {
  const dir = fixture({});
  const r = scoreProject(dir);
  assert.equal(r.reason, 'NO_ARTIFACT');
  assert.equal(r.pass, false);
  assert.equal(r.metrics.qaPassRate, null);
});

test('クリーン成果物 → pass=true', () => {
  const dir = fixture({ 'state.md': CLEAN_STATE, 'build-log.md': '### T-001: 完了\n', 'qa-report.md': '| a | ✅ |\n' });
  const r = scoreProject(dir);
  assert.equal(r.pass, true);
  assert.deepEqual(
    [r.metrics.failForward, r.metrics.escalation, r.metrics.skippedDep, r.metrics.qaPassRate, r.metrics.tasksFailed],
    [0, 0, 0, 1, 0]
  );
});

test('ESCALATION 1件 → pass=false', () => {
  const dir = fixture({ 'state.md': CLEAN_STATE, 'build-log.md': '### [ESCALATION] T-001\n' });
  assert.equal(scoreProject(dir).pass, false);
});

test('qa-report に ✅/❌ なし → qaPassRate=null（0除算しない）', () => {
  const dir = fixture({ 'state.md': CLEAN_STATE, 'qa-report.md': 'まだ検証していない\n' });
  assert.equal(scoreProject(dir).metrics.qaPassRate, null);
});

test('トークン差分: 負値（5hブロック境界跨ぎ）→ null、正値はそのまま', () => {
  const dir = fixture({ 'state.md': CLEAN_STATE });
  assert.equal(scoreProject(dir, { tokensBefore: 100, tokensAfter: 50 }).metrics.tokensUsed, null);
  assert.equal(scoreProject(dir, { tokensBefore: 100, tokensAfter: 350 }).metrics.tokensUsed, 250);
  assert.equal(scoreProject(dir, { tokensBefore: null, tokensAfter: 350 }).metrics.tokensUsed, null);
});
