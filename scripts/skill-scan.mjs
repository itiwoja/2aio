#!/usr/bin/env node
// Ring-4 スキル整合スキャン CLI（Wave C・report-first）。skills/ 配下の vendored スキルを
// ネイティブ・オフラインで走査し、findings を trust/severity/policy 別に報告する。
//   node scripts/skill-scan.mjs [<skillsRoot>] [--gate] [--json]
// --gate: policy=block のスキルが1つでもあれば非0終了（CI ゲート）。既定は advisory（exit 0）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSkillDir, classifyTrust, decidePolicy } from '../security/skill-integrity/scanner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const gate = argv.includes('--gate');
const asJson = argv.includes('--json');
const skillsRoot = argv.find((a) => !a.startsWith('--')) || path.join(ROOT, 'skills');

// skills/<category>/<skill>/SKILL.md（通常）と skills/<category>/SKILL.md（浅い）両対応。
function collectSkillDirs(root) {
  const dirs = [];
  let cats; try { cats = fs.readdirSync(root, { withFileTypes: true }); } catch { return dirs; }
  for (const c of cats) {
    if (!c.isDirectory()) continue;
    const cdir = path.join(root, c.name);
    if (fs.existsSync(path.join(cdir, 'SKILL.md'))) { dirs.push(cdir); continue; }
    for (const s of fs.readdirSync(cdir, { withFileTypes: true })) {
      if (s.isDirectory() && fs.existsSync(path.join(cdir, s.name, 'SKILL.md'))) dirs.push(path.join(cdir, s.name));
    }
  }
  return dirs;
}

const results = [];
for (const dir of collectSkillDirs(skillsRoot)) {
  const { findings, maxSeverity } = scanSkillDir(dir);
  let sourceText = '';
  try { sourceText = fs.readFileSync(path.join(dir, 'SOURCE.md'), 'utf8'); } catch { /* no SOURCE.md */ }
  const trust = classifyTrust(sourceText);
  const policy = decidePolicy(trust, maxSeverity);
  if (findings.length || trust === 'unknown') results.push({ skill: path.relative(skillsRoot, dir), trust, maxSeverity, policy, findings });
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const dim = (s) => `\x1b[2m${s}\x1b[0m`;
  const tag = { block: '\x1b[31mBLOCK\x1b[0m', warn: '\x1b[33mWARN \x1b[0m', allow: '\x1b[32mALLOW\x1b[0m' };
  const order = { block: 0, warn: 1, allow: 2 };
  results.sort((a, b) => order[a.policy] - order[b.policy]);
  for (const r of results) {
    console.log(`${tag[r.policy]}  ${r.skill}  ${dim(`(trust:${r.trust} · max:${r.maxSeverity})`)}`);
    for (const f of r.findings) console.log(`   ${f.file}:${f.line} [${f.severity}/${f.category}] ${f.note} ${dim(':: ' + f.snippet)}`);
    if (!r.findings.length && r.trust === 'unknown') console.log(dim('   SOURCE.md が無く provenance 不明（vendored 集合での無出典は要確認）'));
  }
  const nb = results.filter((r) => r.policy === 'block').length;
  const nw = results.filter((r) => r.policy === 'warn').length;
  const nu = results.filter((r) => r.trust === 'unknown').length;
  console.log(`\nscanned ${skillsRoot}: block ${nb} · warn ${nw} · unknown-provenance ${nu}`);
  if (nb && !gate) console.log('(--gate を付けると block を非0終了で CI ゲートにできます)');
}

process.exit(gate && results.some((r) => r.policy === 'block') ? 1 : 0);
