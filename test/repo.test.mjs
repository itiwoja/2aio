// リポジトリURL解析・新規/既存判定のテスト。実行: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseRepoUrl, classifyRepo } from '../lib/repo.mjs';

test('parseRepoUrl: https / .git付き / 末尾スラッシュ / SSH を解析', () => {
  assert.deepEqual(parseRepoUrl('https://github.com/itiwoja/ccc'), { host: 'github.com', owner: 'itiwoja', name: 'ccc', slug: 'itiwoja/ccc' });
  assert.deepEqual(parseRepoUrl('https://github.com/itiwoja/ccc.git'), { host: 'github.com', owner: 'itiwoja', name: 'ccc', slug: 'itiwoja/ccc' });
  assert.equal(parseRepoUrl('https://github.com/itiwoja/ccc/').name, 'ccc');
  assert.deepEqual(parseRepoUrl('git@github.com:itiwoja/ccc.git'), { host: 'github.com', owner: 'itiwoja', name: 'ccc', slug: 'itiwoja/ccc' });
});

test('parseRepoUrl: 不正な入力は null', () => {
  for (const u of ['', 'not-a-url', 'https://github.com/only-owner', null]) assert.equal(parseRepoUrl(u), null);
});

function mk(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ccc-repo-'));
  for (const [f, c] of Object.entries(files)) {
    const p = path.join(d, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c || '');
  }
  return d;
}

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
