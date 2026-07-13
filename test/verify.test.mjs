import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyDraft } from '../lib/verify.mjs';

test('正しい js フェンスは issues を出さない', async () => {
  const result = await verifyDraft('```js\nconst value = 42;\n```');
  assert.deepEqual(result, { issues: [], uncertainties: [] });
});

test('構文エラーの js フェンスは issues に入る', async () => {
  const result = await verifyDraft('```javascript\nconst x = ;\n```');
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /^コードフェンス#1 \(js\) 構文エラー:/);
  assert.deepEqual(result.uncertainties, []);
});

test('壊れた json フェンスは issues に入る', async () => {
  const result = await verifyDraft('```json\n{"value": }\n```');
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0], /^コードフェンス#1 \(json\) 構文エラー:/);
  assert.deepEqual(result.uncertainties, []);
});

test('フェンスも URL もない markdown は空の結果を返す', async () => {
  const result = await verifyDraft('# 下書き\n\n検証対象はありません。');
  assert.deepEqual(result, { issues: [], uncertainties: [] });
});

// URL 生存確認そのものはネットワーク依存のためユニットテスト対象外だが、
// SSRF ガード（内部宛先の拒否）は fetch 前に決定的に働くためテストできる。
test('SSRF ガード: 内部/ループバック宛先 URL は fetch せず uncertainties に記録する', async () => {
  const md = [
    'http://127.0.0.1:7900/api/control',
    'http://localhost:8080/',
    'http://169.254.169.254/latest/meta-data/', // クラウドメタデータ
    'http://192.168.0.1/admin',
  ].map((u) => `- ${u}`).join('\n');
  const result = await verifyDraft(`# 参照\n\n${md}\n`);
  assert.equal(result.issues.length, 0);
  assert.equal(result.uncertainties.length, 4, '4件すべてが内部宛先として弾かれる');
  for (const note of result.uncertainties) assert.match(note, /内部宛先の可能性/);
});
