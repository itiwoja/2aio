// 2AIO Codex model router — pick the cheapest Codex tier that fits a delegated task.
// Default Terra; Luna for mechanical/bulk; Sol only when explicitly hard. Pure + testable.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = process.env.CODEX_ROUTER_RULES || path.join(HERE, "routing-rules.json");

export function loadRules(p = RULES_PATH) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const RANK = { luna: 0, terra: 1, sol: 2 };

function hits(text, kws) {
  const l = text.toLowerCase();
  return kws.filter((k) => l.includes(k.toLowerCase()));
}

/**
 * classify(task, opts) -> { model, tier, reason, matched }
 * model is the concrete codex model id (e.g. gpt-5.6-terra).
 */
export function classify(task = "", opts = {}) {
  const rules = opts.rules || loadRules();
  const text = String(task || "");
  const matched = [];
  let tier = rules.default; // terra
  let reason = "default implementation from a clear spec";

  const solHits = hits(text, rules.tiers.sol.keywords);
  const lunaHits = hits(text, rules.tiers.luna.keywords);

  // Sol only when explicitly hard; otherwise prefer cheap. Luna for mechanical.
  if (solHits.length) { tier = "sol"; reason = rules.tiers.sol.reason; matched.push(...solHits); }
  else if (lunaHits.length) { tier = "luna"; reason = rules.tiers.luna.reason; matched.push(...lunaHits); }

  const s = rules.signals || {};
  if (s.many_files_regex && new RegExp(s.many_files_regex, "i").test(text) && tier === rules.default) {
    tier = s.many_files_tier; reason = "signal: bulk / many files";
  }
  if (s.explicitly_hard_regex && new RegExp(s.explicitly_hard_regex, "i").test(text)) {
    if (RANK[s.explicitly_hard_tier] > RANK[tier]) { tier = s.explicitly_hard_tier; reason = "signal: explicitly hard"; }
  }

  return { model: rules.models[tier], tier, reason, matched };
}
