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
    `Per the 2AIO operating model you are the COMMANDER: plan deeply, then delegate the typing to Codex. ` +
    `Do NOT hand-write the implementation. Steps: ` +
    `(1) PLAN with a 2AIO sub-agent — launch the \`2aio-planner\` agent (add \`2aio-cto\` for heavy tech, ` +
    `design skills for UI) to draft WBS + files-in-scope + data model; ` +
    `(2) as commander, REVIEW its draft and fill the 3 things sub-agents miss — measurable acceptance ` +
    `criteria, resolved EDGE CASES (don't leave these for Codex), and conventions — then WRITE it to ` +
    `\`<project-dir>/.ai/codex_brief_<slug>.md\`; ` +
    `(3) DELEGATE: \`bash ~/.claude/codex-router/codex-run.sh --write -C <project-dir> "implement .ai/codex_brief_<slug>.md exactly"\` ` +
    `(auto Terra/Luna; --bg for large work); ` +
    `(4) REVIEW Codex's output against the acceptance criteria (git diff) and integrate. ` +
    `Logged to ~/.claude/logs/2aio-usage.jsonl. Only implement inline for a few-line or security/judgment-critical change.`;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx },
  }));
  process.exit(0);
} catch {
  process.exit(0);
}
