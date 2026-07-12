#!/usr/bin/env node
// CLI: print the auto-picked Codex model id for a delegated task.
//   node pick-codex.mjs "scaffold boilerplate tests for the api"   -> gpt-5.6-luna
//   node pick-codex.mjs "implement the login form component"        -> gpt-5.6-terra
//   node pick-codex.mjs --json "complex concurrency refactor"       -> {"model":"gpt-5.6-sol",...}
import { classify } from "./codex-router.mjs";
const args = process.argv.slice(2);
const json = args.includes("--json");
const task = args.filter((a) => a !== "--json").join(" ");
const r = classify(task);
process.stdout.write(json ? JSON.stringify(r) : r.model);
