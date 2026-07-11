#!/usr/bin/env node
// CLI: print the auto-picked model for a task.
//   node pick.mjs "refactor the whole auth system"        -> opus
//   node pick.mjs --json "rename these files"             -> {"model":"haiku",...}
//   node pick.mjs --budget=0.1 "design the architecture"  -> sonnet (downgraded)
// Use in shells/orchestrators:  MODEL=$(node pick.mjs "$TASK")
import { classify } from "./router.mjs";

const args = process.argv.slice(2);
let json = false;
let budget;
const parts = [];
for (const a of args) {
  if (a === "--json") json = true;
  else if (a.startsWith("--budget=")) budget = parseFloat(a.slice("--budget=".length));
  else parts.push(a);
}
const task = parts.join(" ");
const opts = {};
if (Number.isFinite(budget)) opts.budgetLeftFraction = budget;

const res = classify(task, opts);
if (json) process.stdout.write(JSON.stringify(res));
else process.stdout.write(res.model);
