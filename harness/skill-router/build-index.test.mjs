import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SCRIPT = path.join(HERE, "build-index.mjs");

// #61: invokable skill ID must be the directory name (runtime registration ID),
// never frontmatter `name` — some vendored SKILL.md files keep an unmodified
// upstream name that differs from the dir they're installed under.
test("skill id is the directory name even when frontmatter name differs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "2aio-build-index-"));
  try {
    const skillDir = path.join(root, "soft-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: high-end-visual-design\ndescription: use when designing a high-end visual\n---\nbody\n"
    );
    const outFile = path.join(root, "skill-index.json");
    const result = spawnSync(process.execPath, [SCRIPT, root, outFile], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const index = JSON.parse(fs.readFileSync(outFile, "utf8"));
    assert.equal(index.skills.length, 1);
    assert.equal(index.skills[0].name, "soft-skill");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
