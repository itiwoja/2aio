#!/usr/bin/env node
// 2AIO UserPromptSubmit hook — auto-detect implementation tasks and DIRECT the
// assistant to delegate the coding to Codex (Terra/Luna) instead of hand-writing it.
// This is what makes delegation "automatic": the user types a normal request and the
// harness pushes toward delegation without them invoking /2aio-delegate.
//
// Hard limit (grounded): hooks cannot call tools or force the model — this injects a
// STRONG directive via additionalContext. It fails open: any error exits 0, no output.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shouldDelegate, loadDelegateRules } from "./delegate-intent.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    setTimeout(() => resolve(data), 200);
  });
}

try {
  const raw = await readStdin();
  let input = {};
  try { input = JSON.parse(raw || "{}"); } catch { input = {}; }
  const prompt = input.prompt || input.user_prompt || "";
  if (!prompt) process.exit(0);

  const rules = loadDelegateRules();
  const r = shouldDelegate(prompt, { rules });
  if (!r.delegate) process.exit(0);

  const ctx =
    `[2AIO auto-delegate] This looks like an implementation task (matched "${r.matched}"). ` +
    `Per 2AIO token-saving policy, do NOT hand-write the implementation yourself. Instead: ` +
    `(1) plan it thoroughly, (2) delegate the coding to Codex by running ` +
    `\`bash ~/.claude/codex-router/codex-run.sh --write -C <project-dir> "<concrete task>"\` ` +
    `(auto-picks Terra/Luna; add --bg for large work), then (3) review Codex's output ` +
    `(git diff + the acceptance criteria) and integrate it. Every delegation is logged to ` +
    `~/.claude/logs/2aio-usage.jsonl. Only implement inline when the change is a few lines, ` +
    `or is security/judgment-critical (those stay with you). If you delegate, say so briefly.`;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx },
  }));
  process.exit(0);
} catch {
  process.exit(0);
}
