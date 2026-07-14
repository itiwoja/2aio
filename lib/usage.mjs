// LLM使用量の記録/集計（ローカルOllama=トークンのみ・無料 / Claude=トークン＋コスト$）
import fs from 'node:fs';
import path from 'node:path';
import { redactObject } from './redact.mjs';
const f = (root) => path.join(root, 'usage.jsonl');

export function recordUsage(root, e) {
  // usage 行は task テキスト等を含みうる(ai-run.sh 経由)。秘密を残さないよう墨消ししてから追記。
  // トークン“数”のキー(inTok/tokensBefore 等)は redactObject が温存する。
  try { fs.appendFileSync(f(root), JSON.stringify(redactObject({ time: new Date().toISOString(), ...e })) + '\n'); } catch {}
}
export function readUsage(root) {
  try { return fs.readFileSync(f(root), 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}
export function aggregateUsage(root) {
  const rows = readUsage(root);
  const a = { ollama: { calls: 0, inTok: 0, outTok: 0 }, claude: { calls: 0, inTok: 0, cacheTok: 0, outTok: 0, cost: 0 } };
  const today = new Date().toISOString().slice(0, 10);
  const td = { ollamaTok: 0, claudeTok: 0, cost: 0 };
  for (const r of rows) {
    if (r.backend === 'ollama') {
      a.ollama.calls++; a.ollama.inTok += r.inTok || 0; a.ollama.outTok += r.outTok || 0;
      if ((r.time || '').startsWith(today)) td.ollamaTok += (r.inTok || 0) + (r.outTok || 0);
    } else if (r.backend === 'claude') {
      a.claude.calls++; a.claude.inTok += r.inTok || 0; a.claude.cacheTok += r.cacheTok || 0; a.claude.outTok += r.outTok || 0; a.claude.cost += r.costUsd || 0;
      if ((r.time || '').startsWith(today)) { td.claudeTok += (r.inTok || 0) + (r.cacheTok || 0) + (r.outTok || 0); td.cost += r.costUsd || 0; }
    }
  }
  return { agg: a, today: td, recent: rows.slice(-40).reverse() };
}
