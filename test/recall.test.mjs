// リコール検索のテスト（Wave B）。日本語の trigram 部分一致・LIKE フォールバック・
// 重複排除・自動化ソース降格・ログ抽出を固定する。実行: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openIndex, ingest, search, charLen,
  recordsFromWorkerNdjson, recordsFromClaudeJsonl, isAutomationSource,
} from '../lib/recall.mjs';

test('FTS trigram: 3 字以上の日本語部分一致を引ける', () => {
  const db = openIndex();
  ingest(db, [
    { source: 'session', session: 's1', body: '日本語のセッション記録テストをした' },
    { source: 'session', session: 's2', body: 'unrelated english about deployment' },
  ]);
  const hits = search(db, 'セッション記録').map((r) => r.body);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /日本語のセッション/);
});

test('LIKE フォールバック: 2 字以下は MATCH で空 → LIKE で引ける', () => {
  const db = openIndex();
  ingest(db, [{ source: 'session', session: 's1', body: 'デプロイに失敗した' }]);
  assert.equal(search(db, '失敗', { mode: 'fts' }).length, 0);   // trigram は 2 字で空
  const auto = search(db, '失敗');                                // auto は LIKE に落ちる
  assert.equal(auto.length, 1);
  assert.match(auto[0].body, /失敗/);
});

test('英語の部分一致も trigram で引ける', () => {
  const db = openIndex();
  ingest(db, [{ source: 'session', body: 'the rollback strategy worked' }]);
  assert.equal(search(db, 'rollback').length, 1);
});

test('重複排除: 同じレコードの再取り込みはスキップされる', () => {
  const db = openIndex();
  const recs = [{ source: 'worker', session: 'j1', ts: 't', body: '同一行のテスト内容' }];
  const a = ingest(db, recs);
  const b = ingest(db, recs);
  assert.equal(a.ingested, 1);
  assert.equal(b.ingested, 0);
  assert.equal(b.skipped, 1);
  assert.equal(search(db, '同一行のテスト').length, 1); // 重複挿入されていない
});

test('自動化ソース(worker)は同点でも session より下位に降格される', () => {
  const db = openIndex();
  ingest(db, [
    { source: 'worker', session: 'j1', body: 'デプロイ手順のメモ' },
    { source: 'session', session: 's1', body: 'デプロイ手順のメモ' },
  ]);
  const res = search(db, 'デプロイ手順');
  assert.equal(res.length, 2);
  assert.equal(res[0].source, 'session', 'session が上位に来るべき');
  assert.equal(res[1].source, 'worker');
  assert.equal(isAutomationSource('worker'), true);
  assert.equal(isAutomationSource('session'), false);
});

test('空クエリは [] を返す', () => {
  const db = openIndex();
  ingest(db, [{ source: 'session', body: 'something' }]);
  assert.deepEqual(search(db, ''), []);
  assert.deepEqual(search(db, '   '), []);
});

test('charLen: サロゲートペアを 1 文字と数える', () => {
  assert.equal(charLen('本語'), 2);
  assert.equal(charLen('本語の'), 3);
  assert.equal(charLen('🚀🚀'), 2);
});

test('recordsFromWorkerNdjson: assistant/result/raw を抽出し非テキストは落とす', () => {
  const nd = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ルーターを配線した' }] } }),
    JSON.stringify({ type: 'result', result: '完了しました' }),
    JSON.stringify({ type: 'system', subtype: 'init' }), // テキスト無し→落ちる
    'not json at all',                                    // raw フォールバック
  ].join('\n');
  const recs = recordsFromWorkerNdjson(nd, { session: 'j9' });
  const bodies = recs.map((r) => r.body);
  assert.ok(bodies.includes('ルーターを配線した'));
  assert.ok(bodies.includes('完了しました'));
  assert.ok(bodies.includes('not json at all'));
  assert.ok(recs.every((r) => r.source === 'worker' && r.session === 'j9'));
  assert.equal(recs.length, 3); // system 行は除外
});

test('recordsFromClaudeJsonl: 文字列/配列どちらの content も抽出する', () => {
  const jl = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'Windows のパスでコケた' } }),
    JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'CRLF を LF に直した' }, { type: 'tool_use', name: 'Edit' }] } }),
    JSON.stringify({ message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] } }), // テキスト無し
  ].join('\n');
  const recs = recordsFromClaudeJsonl(jl, { session: 'proj-abc' });
  assert.equal(recs.length, 2);
  assert.equal(recs[0].role, 'user');
  assert.match(recs[0].body, /Windows のパス/);
  assert.match(recs[1].body, /CRLF/);
  assert.ok(recs.every((r) => r.source === 'session'));
});
