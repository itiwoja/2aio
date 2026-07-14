// 対話ヒアリングのプロンプト生成・応答検証のテスト。実行: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInterview, validateInterview, briefToPlanPrompt, laneInvocation, IMPLEMENT_CHAIN_PROMPT } from '../lib/intake.mjs';

test('buildInterview: repoラベルと会話履歴をプロンプトに含める', () => {
  const { sys, user } = buildInterview([{ role: 'assistant', content: '何を作りますか?' }, { role: 'user', content: 'ToDoアプリ' }], { slug: 'me/todo', name: 'todo' });
  assert.match(sys, /me\/todo/);
  assert.match(sys, /1問ずつ|1問だけ|1問/);
  assert.match(user, /ToDoアプリ/);
});

test('buildInterview: 履歴が空でも最初の質問を促す', () => {
  const { user } = buildInterview([], { name: 'x' });
  assert.match(user, /まだ無し|最初の質問/);
});

test('validateInterview: 未完了は question 必須', () => {
  assert.deepEqual(validateInterview({ done: false, question: '対象ユーザーは?', brief: '' }), { done: false, question: '対象ユーザーは?', brief: '' });
  assert.equal(validateInterview({ done: false, question: '', brief: '' }), null);
});

test('validateInterview: 完了は brief 必須', () => {
  assert.deepEqual(validateInterview({ done: true, question: '', brief: '目的:...' }), { done: true, question: '', brief: '目的:...' });
  assert.equal(validateInterview({ done: true, question: '', brief: '' }), null);
});

test('validateInterview: 非オブジェクトは null', () => {
  for (const v of [null, undefined, 'str', 42]) assert.equal(validateInterview(v), null);
});

test('laneInvocation: レーン定義ファイルの絶対パスと引数を埋め込む', () => {
  const p = laneInvocation('2aio-build', 'テーマ --auto');
  assert.match(p, /[/\\]\.claude[/\\]2aio[/\\]lanes[/\\]2aio-build\.md/);
  assert.match(p, /テーマ --auto/);
  assert.doesNotMatch(p, /~/);
});

test('laneInvocation: 不正なレーン名は throw', () => {
  assert.throws(() => laneInvocation('..-traversal'));
  assert.throws(() => laneInvocation('build'));
  assert.throws(() => laneInvocation('2aio-UPPER'));
});

test('briefToPlanPrompt: レーンパス参照と「実装はしない」制約を保持する', () => {
  const p = briefToPlanPrompt('目的: ToDo管理', { name: 'todo' });
  assert.match(p, /2aio-plan-project\.md/);
  assert.match(p, /--lite/);
  assert.match(p, /実装はしない/);
});

test('IMPLEMENT_CHAIN_PROMPT: implement レーンを latest --auto で参照する', () => {
  assert.match(IMPLEMENT_CHAIN_PROMPT, /2aio-implement-project\.md/);
  assert.match(IMPLEMENT_CHAIN_PROMPT, /latest --auto/);
});
