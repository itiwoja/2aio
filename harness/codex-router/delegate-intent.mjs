// 2AIO auto-delegate intent detector — pure + testable.
// Decides whether a user prompt is a substantial IMPLEMENTATION task that should be
// delegated to Codex (vs. a question / review / trivial edit that stays inline).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = process.env.DELEGATE_RULES || path.join(HERE, "delegate-rules.json");

export function loadDelegateRules(p = RULES_PATH) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function firstHit(text, kws) {
  const l = text.toLowerCase();
  for (const k of kws) if (l.includes(k.toLowerCase())) return k;
  return null;
}

/**
 * shouldDelegate(prompt, opts) -> { delegate, matched, excluded, reason }
 * delegate=true means: this is an implementation task; direct the assistant to
 * delegate the coding to Codex. Exclusions (questions/review/trivial) win.
 */
export function shouldDelegate(prompt = "", opts = {}) {
  const rules = opts.rules || loadDelegateRules();
  const text = String(prompt || "");
  if (text.trim().length < (rules.min_len || 12)) {
    return { delegate: false, matched: null, excluded: null, reason: "too short" };
  }
  const excluded = firstHit(text, rules.exclude_keywords || []);
  if (excluded) {
    return { delegate: false, matched: null, excluded, reason: `excluded by "${excluded}"` };
  }
  const matched = firstHit(text, rules.implement_keywords || []);
  if (!matched) {
    return { delegate: false, matched: null, excluded: null, reason: "no implementation intent" };
  }
  return { delegate: true, matched, excluded: null, reason: `implementation intent "${matched}"` };
}
