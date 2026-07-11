#!/usr/bin/env node
// 2AIO front-door UserPromptSubmit hook — routes a plain prompt to the right 2AIO
// pipeline (board / redesign / research) and injects a directive to use it, so 2AIO
// fires automatically without the user typing a /2aio-* command.
// Advisory only (hooks can't call tools/force the model). Fail-open: errors exit 0.
import { pickLane, loadRoutes } from "./router.mjs";

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

  const hit = pickLane(prompt, { routes: loadRoutes() });
  if (!hit) process.exit(0);

  const ctx =
    `[2AIO front-door] Matched the "${hit.lane}" lane (via "${hit.matched}"). ${hit.directive} ` +
    `Entry point: ${hit.entry}. The user relies on 2AIO firing automatically — prefer this 2AIO ` +
    `pipeline over an ad-hoc answer unless it clearly does not fit.`;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx },
  }));
  process.exit(0);
} catch {
  process.exit(0);
}
