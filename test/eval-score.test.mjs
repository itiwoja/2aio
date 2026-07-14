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
// 注: build-log テンプレの節見出しは「日本語ラベル（[MARKER]）」形（全角括弧）。scoreProject は
// この見出しを実イベントと数えない（#46）。実イベントは `### [MARKER] ...` の形で書かれる。

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

test('テンプレ節見出し（[ESCALATION]）は実イベントと数えない → pass=true（#46 誤検知回帰）', () => {
  // build-log テンプレの見出し。実エスカレーションは無いので escalation=0・pass=true であるべき
  const dir = fixture({
    'state.md': CLEAN_STATE,
    'build-log.md': '## エスカレーション（[ESCALATION]）\n\nなし\n\n## 新規依存追加（[NEW_DEP]）\n\nなし\n',
    'qa-report.md': '| a | ✅ |\n',
  });
  const r = scoreProject(dir);
  assert.equal(r.metrics.escalation, 0, '見出しの [ESCALATION] は 0 件');
  assert.equal(r.pass, true);
});

test('見出しと実イベントが混在 → 実イベントのみ数える', () => {
  const dir = fixture({
    'state.md': CLEAN_STATE,
    'build-log.md': '## エスカレーション（[ESCALATION]）\n\n### [ESCALATION] T-007 承認待ちで停止\n',
  });
  assert.equal(scoreProject(dir).metrics.escalation, 1);
});

test('qaPassRate: ✅/❌ 記号が無くても overall_judgment: pass → 1.0（#46 形式ドリフト回帰）', () => {
  const dir = fixture({
    'state.md': CLEAN_STATE,
    'qa-report.md': '---\ntype: qa-report\noverall_judgment: pass\n---\n\n**総合判定:** Pass\nPass: 11 件 / Fail: 0 件\n',
  });
  assert.equal(scoreProject(dir).metrics.qaPassRate, 1);
});

test('qaPassRate: overall_judgment: fail → 0.0', () => {
  const dir = fixture({
    'state.md': CLEAN_STATE,
    'qa-report.md': '---\noverall_judgment: fail\n---\n',
  });
  assert.equal(scoreProject(dir).metrics.qaPassRate, 0);
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
