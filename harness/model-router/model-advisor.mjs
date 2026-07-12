#!/usr/bin/env node
// 2AIO UserPromptSubmit hook — advises a model switch (cannot switch directly:
// Claude Code hooks have no model field). It classifies the user's prompt and,
// when a clearly cheaper/stronger tier fits, injects a one-line recommendation
// via additionalContext. Fail-open: any error exits 0 with no output.
import { classify } from "./router.mjs";

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    // guard against no-stdin invocation
    setTimeout(() => resolve(data), 200);
  });
}

try {
  const raw = await readStdin();
  let input = {};
  try { input = JSON.parse(raw || "{}"); } catch { input = {}; }
  const prompt = input.prompt || input.user_prompt || "";
  if (!prompt) process.exit(0);

  const res = classify(prompt);

  // Only advise when a non-default tier clearly fits (reduce noise on ordinary work).
  if (res.tier === "sonnet" && !res.downgraded) process.exit(0);

  const current = input.model || input.session_model || null;
  if (current && String(current).toLowerCase().includes(res.tier)) process.exit(0); // already optimal

  const ctx =
    `[2AIO model-router] This task looks ${res.tier}-class (${res.reason}). ` +
    `If the active model differs, it can be switched with \`/model ${res.tier}\` for better cost/quality. ` +
    `Agents cannot switch models themselves — surface this to the user if a different tier clearly fits, otherwise proceed.`;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx },
  }));
  process.exit(0);
} catch {
  process.exit(0); // never block prompt submission
}
