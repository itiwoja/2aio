#!/usr/bin/env node
// 全履歴リコール検索の CLI（Wave B）。2AIO ワーカーログ（既定）と、任意で Claude Code の
// セッション JSONL を node:sqlite の FTS5 trigram インデックスに取り込み、日本語部分一致で引く。
//   node scripts/recall.mjs ingest [--claude] [--db <path>]
//   node scripts/recall.mjs search <query...> [--limit N] [--mode auto|fts|like] [--db <path>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openIndex, ingest, search, recordsFromWorkerNdjson, recordsFromClaudeJsonl } from '../lib/recall.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DB = path.join(ROOT, 'control', 'recall.db');

function usage() {
  console.error('usage:');
  console.error('  node scripts/recall.mjs ingest [--claude] [--db <path>]');
  console.error('  node scripts/recall.mjs search <query...> [--limit N] [--mode auto|fts|like] [--db <path>]');
  process.exit(2);
}

// フラグと位置引数を分離（--flag value / --claude はブール）。
const argv = process.argv.slice(2);
const cmd = argv.shift();
const positionals = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--claude') flags.claude = true;
  else if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
  else positionals.push(a);
}
const dbPath = flags.db || DEFAULT_DB;

// ディレクトリ配下を再帰的に走査して拡張子一致のファイルを集める。
function listFiles(dir, ext) {
  const out = [];
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

function doIngest() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openIndex(dbPath);
  const total = { ingested: 0, skipped: 0, files: 0 };
  const add = (recs) => { const r = ingest(db, recs); total.ingested += r.ingested; total.skipped += r.skipped; total.files++; };

  // 1) 2AIO ワーカーログ（自己完結・既定ソース）
  for (const f of listFiles(path.join(ROOT, 'control', 'logs'), '.ndjson')) {
    add(recordsFromWorkerNdjson(fs.readFileSync(f, 'utf8'), { session: path.basename(f, '.ndjson') }));
  }
  // 2) Claude Code セッション（オプトイン: 個人データを既定では触らない）
  if (flags.claude) {
    for (const f of listFiles(path.join(os.homedir(), '.claude', 'projects'), '.jsonl')) {
      const session = `${path.basename(path.dirname(f))}/${path.basename(f, '.jsonl')}`;
      add(recordsFromClaudeJsonl(fs.readFileSync(f, 'utf8'), { session }));
    }
  }
  db.close();
  console.log(`ingested ${total.ingested} new records (skipped ${total.skipped} dup/empty) from ${total.files} files`);
  console.log(`index: ${dbPath}${flags.claude ? '' : '   (tip: add --claude to also index Claude Code sessions)'}`);
}

function doSearch() {
  const query = positionals.join(' ').trim();
  if (!query) usage();
  if (!fs.existsSync(dbPath)) {
    console.error(`index not found: ${dbPath}\nrun: node scripts/recall.mjs ingest`);
    process.exit(1);
  }
  const db = openIndex(dbPath);
  const limit = Number(flags.limit) || 20;
  const results = search(db, query, { limit, mode: flags.mode || 'auto' });
  db.close();
  if (!results.length) { console.log(`no matches for: ${query}`); return; }
  for (const r of results) {
    const where = `${r.source}${r.session ? '/' + r.session : ''}`;
    const snippet = r.body.replace(/\s+/g, ' ').trim().slice(0, 160);
    console.log(`\x1b[2m[${where}]${r.ts ? ' ' + r.ts : ''}\x1b[0m\n  ${snippet}`);
  }
  console.log(`\n${results.length} result(s) for: ${query}`);
}

if (cmd === 'ingest') doIngest();
else if (cmd === 'search') doSearch();
else usage();
