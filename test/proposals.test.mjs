// 提案 → 承認反映のテスト（一時ディレクトリ内で完結・実 vault/skills には触れない）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { approveProposal } from '../lib/proposals.mjs';
import { readLog } from '../lib/history.mjs';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2aioforge-test-'));
  const cfg = { paths: {
    vault: path.join(root, 'vault'),
    skills: path.join(root, 'skills'),
    proposals: path.join(root, 'proposals'),
  } };
  fs.mkdirSync(cfg.paths.proposals, { recursive: true });
  return { root, cfg };
}

function writeProposal(cfg, name, side) {
  fs.writeFileSync(path.join(cfg.paths.proposals, name), `# 提案: ${side.id} → ${side.target?.file || ''}\n`);
  fs.writeFileSync(path.join(cfg.paths.proposals, name.replace(/\.md$/, '.json')), JSON.stringify(side));
}

test('サイドカーJSONから承認反映でき、履歴とアーカイブが残る', () => {
  const { root, cfg } = setup();
  const targetPath = path.join(cfg.paths.vault, 'knowledge', 'auto', 'x.md');
  writeProposal(cfg, '2026-07-02_x.md', {
    id: 'x', targetType: 'vault', target: { type: 'vault', file: 'knowledge/auto/x.md' },
    targetPath, risk: 'low', content: '# 更新内容', audit: { pass: true, issues: [] },
  });
  const r = approveProposal(root, cfg, '2026-07-02_x.md');
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), '# 更新内容');
  assert.equal(readLog(root)[0].kind, 'apply');
  assert.equal(fs.existsSync(path.join(cfg.paths.proposals, '2026-07-02_x.md')), false);
  assert.equal(fs.readdirSync(path.join(cfg.paths.proposals, 'approved')).length, 2);
});

test('vault/skills 配下でない targetPath は拒否される', () => {
  const { root, cfg } = setup();
  const evil = path.join(root, 'outside', 'evil.md');
  writeProposal(cfg, '2026-07-02_evil.md', {
    id: 'evil', targetType: 'vault', target: { type: 'vault', file: '../outside/evil.md' },
    targetPath: evil, risk: 'low', content: 'x', audit: { pass: true, issues: [] },
  });
  const r = approveProposal(root, cfg, '2026-07-02_evil.md');
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(evil), false);
  // 拒否された提案はアーカイブされず残る（人が確認できる）
  assert.equal(fs.existsSync(path.join(cfg.paths.proposals, '2026-07-02_evil.md')), true);
});

test('skill 提案は skills 配下へ反映される', () => {
  const { root, cfg } = setup();
  const targetPath = path.join(cfg.paths.skills, 'glassmorphism', 'SKILL.md');
  writeProposal(cfg, '2026-07-02_skill.md', {
    id: 'skill-glassmorphism', targetType: 'skill', target: { type: 'skill', name: 'glassmorphism' },
    targetPath, risk: 'high', content: '# SKILL更新', audit: { pass: true, issues: [] },
  });
  const r = approveProposal(root, cfg, '2026-07-02_skill.md');
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(targetPath, 'utf8'), '# SKILL更新');
});
