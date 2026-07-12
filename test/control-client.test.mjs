// control.mjs のダッシュボードは HTML/JS を巨大なテンプレート文字列として配信するため、
// サーバ側の `node --check` では【クライアントJSの構文エラーを検出できない】。
// 実際に配信される <script> を取り出してコンパイル(実行はしない)し、構文崩れを回帰検出する。
// 背景: 三項演算子のカッコ崩れでダッシュボード全体が沈黙し「ボタンが効かない」事故があった。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'control.mjs'), 'utf8');

test('配信されるクライアント<script>が構文的に正しい', () => {
  // 末尾の `const HTML = \`...\`;` テンプレートを取り出し、評価して「実際に配信される文字列」を得る
  const m = src.match(/const HTML = `([\s\S]*)`;\s*$/);
  assert.ok(m, 'HTMLテンプレートが見つからない');
  const served = new Function('PORT', 'return `' + m[1] + '`')(7900);
  const sm = served.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(sm, '<script> が見つからない');
  // 構文エラーがあれば new vm.Script が throw する(未定義グローバルは実行しないので無関係)
  assert.doesNotThrow(() => new vm.Script(sm[1]), '配信クライアントJSに構文エラー');
});
