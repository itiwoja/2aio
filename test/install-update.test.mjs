import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceInstaller = path.resolve("install.sh");

// Windows では素の "bash" が WSL の System32\bash.exe に解決され、/c/... パスが
// 通らない。Git Bash を優先的に探す（無ければ PATH の bash にフォールバック）。
function resolveBash() {
  if (process.platform !== "win32") return "bash";
  const candidates = [
    "C:/Program Files/Git/bin/bash.exe",
    "C:/Program Files (x86)/Git/bin/bash.exe",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Git/bin/bash.exe") : null,
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return "bash";
}
const BASH = resolveBash();

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "2aio-install-"));
  const repo = path.join(root, "repo");
  const claudeDir = path.join(root, "claude");
  // codexDir is intentionally NOT created here — the installer must treat a missing
  // Codex install as "skip", and tests must never touch the real ~/.codex on the
  // machine running them (CODEX_DIR is always pinned below, in or out of fixture dir).
  const codexDir = path.join(root, "codex");
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.copyFileSync(sourceInstaller, path.join(repo, "install.sh"));
  write(path.join(repo, "agents", "a.md"), "agent\n");
  write(path.join(repo, "agents", "2aio-keep.md"), "keep\n");
  write(path.join(repo, "commands", "2aio-create.md"), "create\n");
  write(path.join(repo, "commands", "2aio-check.md"), "check\n");
  write(path.join(repo, "lanes", "2aio-build.md"), "build lane\n");
  write(path.join(repo, "scripts", "ui-smoke.mjs"), "// smoke\n");
  write(path.join(repo, "skills", "cat", "skill-a", "SKILL.md"), "repo skill-a\n");
  write(path.join(repo, "skills", "cat", "skill-b", "SKILL.md"), "repo skill-b\n");
  return { root, repo, claudeDir, codexDir };
}

function run({ repo, claudeDir, codexDir }, ...args) {
  return spawnSync(BASH, ["install.sh", ...args], {
    cwd: repo,
    env: { ...process.env, CLAUDE_DIR: gitBashPath(claudeDir), CODEX_DIR: gitBashPath(codexDir) },
    encoding: "utf8",
  });
}

function gitBashPath(value) {
  if (process.platform !== "win32") return value;
  return value.replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`).replaceAll("\\", "/");
}

function manifest(dir) {
  return fs.readFileSync(path.join(dir, ".2aio-manifest"), "utf8").trim().split(/\r?\n/);
}

function cleanup({ root }) {
  fs.rmSync(root, { recursive: true, force: true });
}

test("通常インストールは新規スキルをマニフェストに記録する", () => {
  const env = fixture();
  try {
    assert.equal(run(env).status, 0);
    assert.equal(fs.readFileSync(path.join(env.claudeDir, "skills", "skill-a", "SKILL.md"), "utf8"), "repo skill-a\n");
    assert.deepEqual(manifest(env.claudeDir), ["skill-a", "skill-b"]);
  } finally { cleanup(env); }
});

test("通常インストールは既存スキルを変更も登録もしない", () => {
  const env = fixture();
  try {
    write(path.join(env.claudeDir, "skills", "skill-a", "SKILL.md"), "user version\n");
    assert.equal(run(env).status, 0);
    assert.equal(fs.readFileSync(path.join(env.claudeDir, "skills", "skill-a", "SKILL.md"), "utf8"), "user version\n");
    assert.deepEqual(manifest(env.claudeDir), ["skill-b"]);
  } finally { cleanup(env); }
});

test("--update は管理済みだけを更新しユーザースキルを守る", () => {
  const env = fixture();
  try {
    assert.equal(run(env).status, 0);
    write(path.join(env.claudeDir, "skills", "skill-a", "SKILL.md"), "changed locally\n");
    write(path.join(env.claudeDir, "skills", "user-x", "SKILL.md"), "user skill\n");
    assert.equal(run(env, "--update").status, 0);
    assert.equal(fs.readFileSync(path.join(env.claudeDir, "skills", "skill-a", "SKILL.md"), "utf8"), "repo skill-a\n");
    assert.equal(fs.readFileSync(path.join(env.claudeDir, "skills", "user-x", "SKILL.md"), "utf8"), "user skill\n");
  } finally { cleanup(env); }
});

test("--update は管理済みスキルの古いファイルを残さない", () => {
  const env = fixture();
  try {
    assert.equal(run(env).status, 0);
    write(path.join(env.claudeDir, "skills", "skill-a", "extra.md"), "obsolete\n");
    assert.equal(run(env, "--update").status, 0);
    assert.equal(fs.existsSync(path.join(env.claudeDir, "skills", "skill-a", "extra.md")), false);
  } finally { cleanup(env); }
});

test("--adopt-all は既存の同梱スキルをコピーせず登録する", () => {
  const env = fixture();
  try {
    write(path.join(env.claudeDir, "skills", "skill-a", "SKILL.md"), "existing skill\n");
    assert.equal(run(env, "--adopt-all").status, 0);
    assert.deepEqual(manifest(env.claudeDir), ["skill-a", "skill-b"]);
    assert.equal(fs.readFileSync(path.join(env.claudeDir, "skills", "skill-a", "SKILL.md"), "utf8"), "existing skill\n");
  } finally { cleanup(env); }
});

test("--adopt-all --update は採用してから更新する", () => {
  const env = fixture();
  try {
    write(path.join(env.claudeDir, "skills", "skill-a", "SKILL.md"), "old local skill\n");
    assert.equal(run(env, "--adopt-all", "--update").status, 0);
    assert.equal(fs.readFileSync(path.join(env.claudeDir, "skills", "skill-a", "SKILL.md"), "utf8"), "repo skill-a\n");
    assert.deepEqual(manifest(env.claudeDir), ["skill-a", "skill-b"]);
  } finally { cleanup(env); }
});

test("同じコマンドを二回実行しても成功しマニフェストは不変", () => {
  const env = fixture();
  try {
    assert.equal(run(env).status, 0);
    const first = fs.readFileSync(path.join(env.claudeDir, ".2aio-manifest"), "utf8");
    assert.equal(run(env).status, 0);
    assert.equal(fs.readFileSync(path.join(env.claudeDir, ".2aio-manifest"), "utf8"), first);
  } finally { cleanup(env); }
});

test("不明なフラグは失敗する", () => {
  const env = fixture();
  try {
    assert.notEqual(run(env, "--unknown").status, 0);
  } finally { cleanup(env); }
});

test("入口 2 コマンドと lanes を配備し、引退した 2aio コマンドだけ掃除する", () => {
  const env = fixture();
  try {
    write(path.join(env.claudeDir, "commands", "2aio-old.md"), "retired\n");
    write(path.join(env.claudeDir, "commands", "user-note.md"), "preserve\n");
    const result = run(env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(env.claudeDir, "commands", "2aio-old.md")), false);
    assert.equal(fs.readFileSync(path.join(env.claudeDir, "commands", "user-note.md"), "utf8"), "preserve\n");
    assert.equal(fs.readFileSync(path.join(env.claudeDir, "commands", "2aio-create.md"), "utf8"), "create\n");
    assert.equal(fs.readFileSync(path.join(env.claudeDir, "commands", "2aio-check.md"), "utf8"), "check\n");
    assert.equal(fs.readFileSync(path.join(env.claudeDir, "2aio", "lanes", "2aio-build.md"), "utf8"), "build lane\n");
    assert.equal(fs.readFileSync(path.join(env.claudeDir, "2aio", "scripts", "ui-smoke.mjs"), "utf8"), "// smoke\n");
    assert.match(result.stdout, /removed retired command: 2aio-old\.md/);
  } finally { cleanup(env); }
});

test("lanes は再実行で常に repo 版へ上書きされる", () => {
  const env = fixture();
  try {
    assert.equal(run(env).status, 0);
    write(path.join(env.repo, "lanes", "2aio-build.md"), "build lane v2\n");
    assert.equal(run(env).status, 0);
    assert.equal(fs.readFileSync(path.join(env.claudeDir, "2aio", "lanes", "2aio-build.md"), "utf8"), "build lane v2\n");
  } finally { cleanup(env); }
});

test("廃止された 2aio エージェントだけを削除する", () => {
  const env = fixture();
  const retired = `2aio-${["c", "f", "o"].join("")}.md`;
  try {
    write(path.join(env.claudeDir, "agents", retired), "retired\n");
    write(path.join(env.claudeDir, "agents", "my-agent.md"), "preserve\n");
    const result = run(env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(env.claudeDir, "agents", retired)), false);
    assert.equal(fs.readFileSync(path.join(env.claudeDir, "agents", "my-agent.md"), "utf8"), "preserve\n");
    assert.equal(fs.readFileSync(path.join(env.claudeDir, "agents", "2aio-keep.md"), "utf8"), "keep\n");
    assert.ok(result.stdout.includes(`removed retired agent: ${retired}`));
  } finally { cleanup(env); }
});

test("Codex 未インストール（~/.codex が無い）なら codex/skills は作られない", () => {
  const env = fixture();
  try {
    assert.equal(run(env).status, 0);
    assert.equal(fs.existsSync(path.join(env.codexDir, "skills")), false);
  } finally { cleanup(env); }
});

test("Codex インストール済みなら同じスキルを ~/.codex/skills にも配備する", () => {
  const env = fixture();
  try {
    fs.mkdirSync(env.codexDir, { recursive: true });
    assert.equal(run(env).status, 0);
    assert.equal(fs.readFileSync(path.join(env.codexDir, "skills", "skill-a", "SKILL.md"), "utf8"), "repo skill-a\n");
    assert.equal(fs.readFileSync(path.join(env.codexDir, "skills", "skill-b", "SKILL.md"), "utf8"), "repo skill-b\n");
  } finally { cleanup(env); }
});

test("Codex 側も既存スキルは上書きせず --update は管理済みだけ更新する", () => {
  const env = fixture();
  try {
    fs.mkdirSync(env.codexDir, { recursive: true });
    assert.equal(run(env).status, 0);
    write(path.join(env.codexDir, "skills", "skill-a", "SKILL.md"), "changed on codex side\n");
    write(path.join(env.codexDir, "skills", "user-x", "SKILL.md"), "user skill\n");
    assert.equal(run(env, "--update").status, 0);
    assert.equal(fs.readFileSync(path.join(env.codexDir, "skills", "skill-a", "SKILL.md"), "utf8"), "repo skill-a\n");
    assert.equal(fs.readFileSync(path.join(env.codexDir, "skills", "user-x", "SKILL.md"), "utf8"), "user skill\n");
  } finally { cleanup(env); }
});
