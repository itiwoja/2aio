// 提案の解決・承認・アーカイブ。承認時の書き込み先は cfg.paths.vault / cfg.paths.skills 配下に限定する。
import fs from 'node:fs';
import path from 'node:path';
import { applyWithHistory } from './history.mjs';
import { within } from './paths.mjs';

const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });

// 提案 → {対象パス, 内容} を解決（サイドカーJSON優先・無ければ.mdをパース）
export function resolveProposal(cfg, name) {
  const PROP = cfg.paths.proposals;
  const jp = path.join(PROP, name.replace(/\.md$/, '.json'));
  if (fs.existsSync(jp)) { const j = readJSON(jp); if (j?.targetPath && j.content != null) return { targetPath: j.targetPath, content: j.content, side: j }; }
  const md = fs.readFileSync(path.join(PROP, name), 'utf8');
  const head = md.split('\n').find(l => l.startsWith('# 提案')) || '';
  const tm = head.match(/→\s*(.+?)\s*$/); let targetPath = null;
  if (tm) { const t = tm[1].trim(); targetPath = t.startsWith('skill:') ? path.join(cfg.paths.skills, t.slice(6), 'SKILL.md') : path.join(cfg.paths.vault, t); }
  const cm = md.match(/```markdown\n([\s\S]*?)\n```/);
  return { targetPath, content: cm ? cm[1] : null, side: {} };
}

export function archiveProposal(cfg, name, sub) {
  const PROP = cfg.paths.proposals;
  const dir = path.join(PROP, sub); ensureDir(dir);
  for (const ext of ['.md', '.json']) { const f = name.replace(/\.md$/, ext); const src = path.join(PROP, f); if (fs.existsSync(src)) fs.renameSync(src, path.join(dir, Date.now() + '_' + f)); }
}

// 承認 → バックアップ付きで対象ファイルへ反映し、提案をアーカイブ
export function approveProposal(root, cfg, name) {
  const { targetPath, content, side } = resolveProposal(cfg, name);
  if (!targetPath || content == null) return { ok: false, err: '提案から対象パス/内容を解決できない' };
  if (!within(targetPath, cfg.paths.vault) && !within(targetPath, cfg.paths.skills)) {
    return { ok: false, err: '対象パスが vault/skills 配下でないため拒否: ' + targetPath };
  }
  const rec = applyWithHistory(root, targetPath, content, {
    topic: side.id || name, targetType: side.targetType || '',
    targetDisplay: side.targetType === 'skill' ? 'skill:' + (side.target?.name || '') : (side.target?.file || targetPath),
    reason: '提案を承認して反映: ' + (side.rationale || side.summary || name),
    auditPass: side.audit?.pass, auditIssues: side.audit?.issues || [],
  });
  archiveProposal(cfg, name, 'approved');
  return { ok: true, applied: rec.targetPath, historyId: rec.id };
}
