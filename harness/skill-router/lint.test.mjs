// SKILL.md description lint のテスト（Wave B v1）。実行: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintSkill, DESC_MAX } from './lint.mjs';

test('空 description を警告する', () => {
  assert.match(lintSkill('x', '').join('\n'), /空/);
  assert.match(lintSkill('x', '   ').join('\n'), /空/);
});

test(`${DESC_MAX} 字超を警告する（文字数はコードポイント基準）`, () => {
  const long = 'Use when ' + 'あ'.repeat(DESC_MAX + 5);
  assert.ok(lintSkill('x', long).some((w) => new RegExp(String(DESC_MAX)).test(w)));
});

test('トリガー句が無いと警告する', () => {
  assert.ok(lintSkill('x', 'This formats files nicely.').some((w) => /トリガー/.test(w)));
});

test('英語トリガー句ありの短い description は無警告', () => {
  assert.deepEqual(lintSkill('x', 'Use when formatting TypeScript files.'), []);
});

test('日本語トリガー（…で使う）ありの description は無警告', () => {
  assert.deepEqual(lintSkill('2aio-create', '一から作りたい、といった依頼で使う。'), []);
});
