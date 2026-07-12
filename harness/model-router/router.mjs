// 2AIO model auto-router — classify a task into a model tier.
// Pure + testable. No side effects. Reads routing-rules.json next to this file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = process.env.MODEL_ROUTER_RULES || path.join(HERE, "routing-rules.json");

export function loadRules(rulesPath = RULES_PATH) {
  return JSON.parse(fs.readFileSync(rulesPath, "utf8"));
}

const TIER_RANK = { haiku: 0, sonnet: 1, opus: 2 };

function matchKeywords(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.filter((k) => lower.includes(k.toLowerCase()));
}

/**
 * classify(task, opts) -> { model, tier, reason, matched, downgraded }
 * opts: { budgetLeftFraction?: number (0..1), rules?: object }
 */
export function classify(task = "", opts = {}) {
  const rules = opts.rules || loadRules();
  const text = String(task || "");
  const matched = [];
  let tier = rules.default; // sonnet
  let reason = "default (general coding/implementation)";

  // 1. keyword tiers — opus wins over haiku when both hit
  const opusHits = matchKeywords(text, rules.tiers.opus.keywords);
  const haikuHits = matchKeywords(text, rules.tiers.haiku.keywords);

  if (opusHits.length) {
    tier = "opus"; reason = rules.tiers.opus.reason; matched.push(...opusHits);
  } else if (haikuHits.length) {
    tier = "haiku"; reason = rules.tiers.haiku.reason; matched.push(...haikuHits);
  }

  // 2. signals (only bump UP toward opus, or explicit quick->haiku when still default)
  const s = rules.signals || {};
  if (s.many_files_regex && new RegExp(s.many_files_regex, "i").test(text)) {
    if (TIER_RANK[s.many_files_tier] > TIER_RANK[tier]) { tier = s.many_files_tier; reason = "signal: spans many files"; }
  }
  if (s.long_prompt_chars && text.length >= s.long_prompt_chars) {
    if (TIER_RANK[s.long_prompt_tier] > TIER_RANK[tier]) { tier = s.long_prompt_tier; reason = "signal: long/complex prompt"; }
  }
  if (s.quick_regex && new RegExp(s.quick_regex, "i").test(text) && tier === rules.default) {
    tier = s.quick_tier; reason = "signal: explicitly quick/simple";
  }

  // 3. budget-aware downgrade
  let downgraded = false;
  const b = rules.budget || {};
  if (typeof opts.budgetLeftFraction === "number" &&
      b.downgrade_below != null &&
      opts.budgetLeftFraction < b.downgrade_below) {
    const next = (b.downgrade_map || {})[tier];
    if (next && next !== tier) {
      reason = `budget low (${Math.round(opts.budgetLeftFraction * 100)}% left) — downgraded ${tier}→${next}`;
      tier = next; downgraded = true;
    }
  }

  return { model: tier, tier, reason, matched, downgraded };
}
