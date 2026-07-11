// 2AIO skill-router matcher — given a prompt + skill index, rank matching skills.
// Pure + testable. Expands JP terms via synonyms.json so Japanese prompts match
// English-described skills.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function loadSynonyms(p = path.join(HERE, "synonyms.json")) {
  try { const o = JSON.parse(fs.readFileSync(p, "utf8")); delete o._comment; return o; }
  catch { return {}; }
}
export function loadIndex(p = path.join(HERE, "skill-index.json")) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function expandPrompt(prompt, synonyms = loadSynonyms()) {
  let text = String(prompt || "").toLowerCase();
  const extra = [];
  for (const [term, adds] of Object.entries(synonyms)) {
    if (text.includes(term.toLowerCase())) extra.push(...adds.map((a) => a.toLowerCase()));
  }
  return text + " " + extra.join(" ");
}

/**
 * match(prompt, index, opts) -> [{ name, score, description, hits }]
 * opts: { topN=3, minScore=2, synonyms }
 */
export function match(prompt, index, opts = {}) {
  const { topN = 3, minScore = 2 } = opts;
  const synonyms = opts.synonyms || loadSynonyms();
  const text = expandPrompt(prompt, synonyms);
  const skills = index.skills || index; // accept wrapped or raw array
  const scored = [];
  for (const s of skills) {
    let score = 0;
    const hits = [];
    for (const { term, w } of s.keywords || []) {
      // word-ish containment (avoid matching inside longer words for short terms)
      const re = term.length <= 4 ? new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`) : null;
      if (re ? re.test(text) : text.includes(term)) { score += w; hits.push(term); }
    }
    if (score >= minScore) scored.push({ name: s.name, score: Math.round(score * 10) / 10, description: s.description, hits });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}
