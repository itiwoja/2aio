// リポジトリURL解析・新規/既存判定のテスト。実行: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseRepoUrl, classifyRepo, detectStack } from '../lib/repo.mjs';

test('parseRepoUrl: https / .git付き / 末尾スラッシュ / SSH を解析', () => {
  assert.deepEqual(parseRepoUrl('https://github.com/itiwoja/2aio'), { host: 'github.com', owner: 'itiwoja', name: '2aio', slug: 'itiwoja/2aio' });
  assert.deepEqual(parseRepoUrl('https://github.com/itiwoja/2aio.git'), { host: 'github.com', owner: 'itiwoja', name: '2aio', slug: 'itiwoja/2aio' });
  assert.equal(parseRepoUrl('https://github.com/itiwoja/2aio/').name, '2aio');
  assert.deepEqual(parseRepoUrl('git@github.com:itiwoja/2aio.git'), { host: 'github.com', owner: 'itiwoja', name: '2aio', slug: 'itiwoja/2aio' });
});

test('parseRepoUrl: 不正な入力は null', () => {
  for (const u of ['', 'not-a-url', 'https://github.com/only-owner', null]) assert.equal(parseRepoUrl(u), null);
});

test('parseRepoUrl: パストラバーサル（.. / バックスラッシュ）は null で弾く', () => {
  const bs = String.fromCharCode(92); // '\'
  const malicious = [
    'https://github.com/owner/..',              // dest が ROOT に解決する典型
    'https://github.com/../evil',               // owner 側 ..
    'https://github.com/owner/.',               // 単一ドット
    `https://github.com/owner/..${bs}..${bs}Windows${bs}Temp${bs}evil`, // Windows パス脱出
    `https://github.com/ow${bs}ner/name`,       // owner 内バックスラッシュ
  ];
  for (const u of malicious) assert.equal(parseRepoUrl(u), null, `should reject: ${u}`);
});

function mk(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), '2aio-repo-'));
  for (const [f, c] of Object.entries(files)) {
    const p = path.join(d, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c || '');
  }
  return d;
}

// ── #11 スタック検出 ──

test('detectStack: package.json scripts からテスト/ビルド/lintコマンドを検出', () => {
  const d = mk({ 'package.json': JSON.stringify({ scripts: { test: 'node --test', build: 'vite build', lint: 'eslint .' } }) });
  assert.deepEqual(detectStack(d), { language: 'javascript', testCmd: 'npm test', buildCmd: 'npm run build', lintCmd: 'npm run lint' });
});

test('detectStack: npm 既定の "no test specified" は testCmd=null', () => {
  const d = mk({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) });
  assert.equal(detectStack(d).testCmd, null);
});

test('detectStack: go.mod → go / 検出材料なし → null', () => {
  assert.equal(detectStack(mk({ 'go.mod': 'module x' })).language, 'go');
  assert.equal(detectStack(mk({ 'README.md': '# x' })), null);
});

test('classifyRepo: stack フィールドを含む', () => {
  const d = mk({ 'package.json': JSON.stringify({ scripts: { test: 'node --test' } }), 'src/i.js': 'x' });
  assert.equal(classifyRepo(d).stack.language, 'javascript');
});

test('classifyRepo: 空 or READMEのみ → new', () => {
  assert.equal(classifyRepo(mk({})).mode, 'new');
  assert.equal(classifyRepo(mk({ 'README.md': '# hi', 'LICENSE': 'MIT', '.gitignore': 'node_modules' })).mode, 'new');
});

test('classifyRepo: ソースコードあり → existing', () => {
  const r = classifyRepo(mk({ 'README.md': '# hi', 'src/index.js': 'console.log(1)', 'src/app.py': 'x=1' }));
  assert.equal(r.mode, 'existing');
  assert.equal(r.codeCount, 2);
});

test('classifyRepo: .git/node_modules は無視される', () => {
  const r = classifyRepo(mk({ 'README.md': '#', '.git/config': 'x', 'node_modules/pkg/index.js': 'y' }));
  assert.equal(r.mode, 'new'); // 実コードは無い扱い
});
