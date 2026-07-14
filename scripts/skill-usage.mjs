#!/usr/bin/env node
// スキル使用テレメトリのレポート（Wave B v1・report-only）。router の match 頻度と、
// 一度も match していないスキル（見直し候補）を表示する。削除は一切しない。
//   node scripts/skill-usage.mjs [--index <skill-index.json>] [--log <path>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUsage, aggregate, usageLogPath } from '../harness/skill-router/usage.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const logPath = flag('--log') || usageLogPath();
const idxPath = flag('--index') || path.join(ROOT, 'harness', 'skill-router', 'skill-index.json');

let index = null;
try { index = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch { /* index 無しでもランキングは出せる */ }

const { ranked, neverMatched, totalEvents } = aggregate(readUsage(logPath), index);
console.log(`skill usage — ${totalEvents} match events\n  log:   ${logPath}\n  index: ${index ? idxPath : '(未生成)'}\n`);

if (!ranked.length) {
  console.log('(まだ記録がありません。skill-advisor が prompt に match するとここに溜まります)');
} else {
  console.log('よく match:');
  for (const r of ranked.slice(0, 20)) console.log(`  ${String(r.count).padStart(4)}  ${r.name}`);
}

if (index) {
  const total = (index.skills || index).length;
  console.log(`\n一度も match していない（${neverMatched.length} / ${total} 件）— 削除ではなく見直し候補:`);
  for (const n of neverMatched.slice(0, 40)) console.log(`  - ${n}`);
  if (neverMatched.length > 40) console.log(`  … 他 ${neverMatched.length - 40} 件`);
} else {
  console.log('\n(never-matched を出すには先に: node harness/skill-router/build-index.mjs)');
}
