// 対話ヒアリングのプロンプト生成・応答検証のテスト。実行: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInterview, validateInterview, briefToBuildPrompt } from '../lib/intake.mjs';

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

test('briefToBuildPrompt: briefとrepo名を実行プロンプトに埋め込む', () => {
  const p = briefToBuildPrompt('目的: ToDo管理', { name: 'todo' });
  assert.match(p, /todo/);
  assert.match(p, /目的: ToDo管理/);
  assert.match(p, /計画|WBS/);
});
