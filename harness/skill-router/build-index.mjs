#!/usr/bin/env node
// Build a keyword index of installed skills for the skill-router.
// Scans <skillsRoot>/*/SKILL.md (and one level deeper, e.g. fable-mode/*/SKILL.md),
// extracts name + description, derives weighted keywords, writes skill-index.json.
//   node build-index.mjs [skillsRoot] [outFile]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lintSkill, DESC_MAX } from "./lint.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = process.argv[2] || path.join(process.env.HOME || process.env.USERPROFILE || ".", ".claude", "skills");
const outFile = process.argv[3] || path.join(HERE, "skill-index.json");

const STOP = new Set(("a an the and or of to in on for with when use used using this that any all your you it its is are be as at by from into via not no do does " +
  "code skill skills task tasks agent agents claude when where what which need needs use uses used using make making build " +
  "before after each other more most less than then them they user users based like such etc via across over under out up down " +
  "review reviewing write writing writes read reading create creating change changing changes work working file files project projects").split(/\s+/));

function parseFrontmatter(mdRaw) {
  const md = String(mdRaw).replace(/^﻿/, "").replace(/\r\n/g, "\n"); // strip BOM, normalize CRLF
  const m = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^(\w+):\s*(.*)$/);
    if (mm) out[mm[1]] = mm[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

function tokens(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w));
}

function keywordsFor(name, desc) {
  const kw = new Map(); // term -> weight (keep max)
  const add = (t, w) => { if (t && t.length >= 3) kw.set(t, Math.max(kw.get(t) || 0, w)); };
  // 1. name tokens (strong signal)
  for (const t of name.toLowerCase().split(/[-_]/)) if (t.length >= 3 && !STOP.has(t)) add(t, 1.5);
  // 2. explicit trigger phrases (strongest)
  const triggers = [];
  const reTrig = /(?:trigger on|triggers on|use when|use it when|use for|use immediately|use this when|use proactively)[:\s]([^.]*)/gi;
  let m;
  while ((m = reTrig.exec(desc))) triggers.push(m[1]);
  for (const t of tokens(triggers.join(" "))) add(t, 2);
  // 3. general description tokens
  for (const t of tokens(desc)) add(t, 1);
  return [...kw.entries()].map(([term, w]) => ({ term, w }));
}

function collectSkillDirs(root) {
  const dirs = [];
  if (!fs.existsSync(root)) return dirs;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const d = path.join(root, e.name);
    if (fs.existsSync(path.join(d, "SKILL.md"))) dirs.push(d);
    else {
      for (const e2 of fs.readdirSync(d, { withFileTypes: true })) {
        if (e2.isDirectory() && fs.existsSync(path.join(d, e2.name, "SKILL.md"))) dirs.push(path.join(d, e2.name));
      }
    }
  }
  return dirs;
}

const index = [];
const warnings = [];
for (const dir of collectSkillDirs(skillsRoot)) {
  const fm = parseFrontmatter(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8"));
  // #61: invokable ID is always the directory name (runtime registration ID), never
  // frontmatter `name` — some vendored SKILL.md files keep an unmodified upstream name
  // that differs from the dir they're installed under (SOURCE.md declares them
  // unmodified/upstream-SoT, so we fix the consumer here instead of rewriting 9+ files).
  const name = path.basename(dir);
  const desc = fm.description || "";
  warnings.push(...lintSkill(name, desc)); // AUTHORING.md 基準の軽量チェック（警告のみ・失敗させない）
  if (!desc) continue;
  index.push({ name, description: desc.slice(0, DESC_MAX), keywords: keywordsFor(name, desc) });
}
index.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(outFile, JSON.stringify({ generatedFrom: skillsRoot, count: index.length, skills: index }, null, 2));
console.log(`skill-index: ${index.length} skills -> ${outFile}`);
if (warnings.length) {
  console.warn(`\n[lint] ${warnings.length} 件の著作基準の警告（skills/2aio/AUTHORING.md 参照）:`);
  for (const w of warnings) console.warn(`  - ${w}`);
}
