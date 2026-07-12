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

// URL 検証はネットワーク依存のため、ユニットテストの対象外とする。
