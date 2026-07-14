// スキル使用テレメトリのテスト（Wave B v1）。実行: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordMatches, readUsage, aggregate } from './usage.mjs';

const tmpLog = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), '2aio-su-')), 'usage.jsonl');

test('recordMatches → readUsage のラウンドトリップ', () => {
  const p = tmpLog();
  recordMatches(['a', 'b'], { at: '2026-07-14T00:00:00Z', logPath: p });
  recordMatches(['a'], { at: '2026-07-14T00:01:00Z', logPath: p });
  const recs = readUsage(p);
  assert.equal(recs.length, 2);
  assert.deepEqual(recs[0].skills, ['a', 'b']);
});

test('recordMatches は空/非配列で何もせず throw もしない（fail-open）', () => {
  const p = tmpLog();
  recordMatches([], { logPath: p });
  recordMatches(null, { logPath: p });
  recordMatches(undefined, { logPath: p });
  assert.equal(readUsage(p).length, 0);
});

test('aggregate: 頻度ランキングと never-matched を出す', () => {
  const recs = [{ skills: ['a', 'b'] }, { skills: ['a'] }, { skills: ['a', 'c'] }];
  const index = { skills: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }] };
  const { ranked, neverMatched, totalEvents } = aggregate(recs, index);
  assert.equal(totalEvents, 3);
  assert.deepEqual(ranked[0], { name: 'a', count: 3 });
  assert.deepEqual(neverMatched, ['d']); // index にあるが未 match
});

test('readUsage: 壊れた行はスキップ、ファイル無しは []', () => {
  const p = tmpLog();
  fs.writeFileSync(p, '{"skills":["a"]}\ngarbage-not-json\n{"skills":["b"]}\n');
  assert.equal(readUsage(p).length, 2);
  assert.deepEqual(readUsage(path.join(os.tmpdir(), 'nope-does-not-exist.jsonl')), []);
});
