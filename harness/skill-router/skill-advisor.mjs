#!/usr/bin/env node
// 2AIO UserPromptSubmit hook — auto-detect relevant skills for the user's prompt and
// inject a directive so the assistant invokes them via the Skill tool. Hooks cannot
// call tools, so this pushes the model toward using skills instead of ignoring them.
// Fail-open: any error exits 0 with no output.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { match, loadIndex, loadSynonyms } from "./matcher.mjs";
import { recordMatches } from "./usage.mjs";

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
  if (!prompt || prompt.length < 4) process.exit(0);

  const index = loadIndex(path.join(HERE, "skill-index.json"));
  const syn = loadSynonyms(path.join(HERE, "synonyms.json"));
  const hits = match(prompt, index, { topN: 3, minScore: 2, synonyms: syn });
  if (!hits.length) process.exit(0);
  recordMatches(hits.map((h) => h.name)); // 使用テレメトリ（fail-open。死んでいるスキルの可視化用）

  const list = hits.map((h) => `${h.name}`).join(", ");
  const ctx =
    `[2AIO skill-router] This task matches installed skills: ${list}. ` +
    `Before proceeding, invoke the most relevant one via the Skill tool (the user relies on skills ` +
    `firing automatically). If none truly fit, proceed without one.`;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx },
  }));
  process.exit(0);
} catch {
  process.exit(0);
}
