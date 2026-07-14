// スキル使用テレメトリ（Wave B v1）。Hermes tools/skill_usage.py の概念borrow。
// router が prompt に対しどのスキルを match したかを追記し、「死んでいる（一度も match しない）」
// スキルを可視化する。方針: report-only・archive のみ・自動削除は絶対にしない（never-delete）。
// 注意: これは "advised(match)" の頻度であり "実際に invoke された" 回数ではない（フックはツール実行を観測できない）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 既存の 2aio-usage.jsonl と同じ ~/.claude/logs 配下に置く。
export function usageLogPath() {
  return path.join(os.homedir() || '.', '.claude', 'logs', '2aio-skill-usage.jsonl');
}

// match したスキル名を追記する。フェイルオープン: フックを壊さないため何があっても throw しない。
export function recordMatches(names, { at = null, logPath = usageLogPath() } = {}) {
  try {
    if (!Array.isArray(names) || names.length === 0) return;
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify({ t: at || new Date().toISOString(), skills: names }) + '\n');
  } catch { /* fail-open */ }
}

export function readUsage(logPath = usageLogPath()) {
  try {
    return fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// 集計（純関数）: match 回数の降順ランキングと、index にあるのに一度も match しないスキル一覧。
export function aggregate(records, index) {
  const counts = new Map();
  for (const r of records || []) for (const s of r.skills || []) counts.set(s, (counts.get(s) || 0) + 1);
  const known = (index?.skills || index || []).map((s) => s.name).filter(Boolean);
  const ranked = [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const neverMatched = known.filter((n) => !counts.has(n)).sort();
  return { ranked, neverMatched, totalEvents: (records || []).length };
}
