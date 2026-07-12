// #17 安全弁の fail-closed 回帰テスト — セキュリティゲート (devops Step 2.5) の前提を固定する。
// (a) スキャナ実体の存在確認: gitleaks.exe / security-scan.mjs が消えると Step 2.5 は
//     フォールバック or [TOOL_MISSING] 停止に落ちる。存在自体をここで回帰化する。
// (b) exit code 契約: gitleaks は 0=clean / 1=leak。この契約が崩れると
//     「非0=leak」前提の判定が無言で壊れるため、ダミー秘密で実際に検証する。
// ダミー秘密は実行時に組み立てる（リポジトリ自体が秘密スキャンに引っかからないため）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const GITLEAKS =
  process.env.GITLEAKS_BIN || "C:/Users/1kkim/projects/tools/gitleaks/gitleaks.exe";
const SECURITY_SCAN =
  process.env.SECURITY_SCAN_MJS || "C:/Users/1kkim/projects/scripts/security-scan.mjs";

// ローカルツールチェーンの回帰テスト — CI (ubuntu) には gitleaks/security-scan が無いためスキップ
const onCI = !!process.env.CI;

test("gitleaks 実体が存在する (Step 2.5 の正本スキャナ)", { skip: onCI && "ローカル環境依存" }, () => {
  assert.ok(
    existsSync(GITLEAKS),
    `gitleaks が見つからない: ${GITLEAKS} — Step 2.5 はフォールバック運用になる。移設したなら GITLEAKS_BIN で指す`
  );
});

test("security-scan.mjs 実体が存在する (Step 2.5 の SAST)", { skip: onCI && "ローカル環境依存" }, () => {
  assert.ok(
    existsSync(SECURITY_SCAN),
    `security-scan.mjs が見つからない: ${SECURITY_SCAN} — 移設したなら SECURITY_SCAN_MJS で指す`
  );
});

function runGitleaks(dir) {
  return spawnSync(GITLEAKS, ["detect", "--no-git", "--no-banner", "-s", dir], {
    encoding: "utf8",
    timeout: 60_000,
  });
}

test("gitleaks exit code 契約: clean ディレクトリ → 0", { skip: !existsSync(GITLEAKS) }, () => {
  const dir = mkdtempSync(join(tmpdir(), "gl-clean-"));
  try {
    writeFileSync(join(dir, "app.js"), 'console.log("no secrets here");\n');
    const r = runGitleaks(dir);
    assert.equal(r.status, 0, `clean で exit ${r.status}: ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gitleaks exit code 契約: ダミー秘密 → 1", { skip: !existsSync(GITLEAKS) }, () => {
  const dir = mkdtempSync(join(tmpdir(), "gl-leak-"));
  try {
    // AWS access key 形式 (AKIA + 16 文字) を実行時に決定的に生成
    // ("EXAMPLE" を含む公式サンプルキーは gitleaks の allowlist に載っていて検出されない)
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ234567";
    let suffix = "";
    for (let i = 0; i < 16; i++) suffix += alphabet[(i * 7 + 3) % alphabet.length];
    const fakeKey = "AKIA" + suffix;
    writeFileSync(join(dir, "config.js"), `const awsAccessKeyId = "${fakeKey}";\n`);
    const r = runGitleaks(dir);
    assert.equal(r.status, 1, `leak で exit ${r.status} (期待 1=leak): ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
