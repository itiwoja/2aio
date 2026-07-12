// 2AIO front-door lane router — pure + testable.
// Maps a plain prompt to the right high-level 2AIO pipeline entry point (board /
// redesign / research). Returns null when no lane clearly matches (most prompts).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_PATH = process.env.FRONTDOOR_ROUTES || path.join(HERE, "routes.json");

export function loadRoutes(p = ROUTES_PATH) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function firstHit(text, kws) {
  const l = text.toLowerCase();
  for (const k of kws) if (l.includes(k.toLowerCase())) return k;
  return null;
}

/**
 * pickLane(prompt, opts) -> { lane, entry, directive, matched } | null
 * First lane (in file order = priority) with a keyword hit wins.
 */
export function pickLane(prompt = "", opts = {}) {
  const routes = opts.routes || loadRoutes();
  const text = String(prompt || "");
  if (text.trim().length < (routes.min_len || 8)) return null;
  for (const lane of routes.lanes || []) {
    const matched = firstHit(text, lane.keywords || []);
    if (matched) {
      return { lane: lane.lane, entry: lane.entry, directive: lane.directive, matched };
    }
  }
  return null;
}
