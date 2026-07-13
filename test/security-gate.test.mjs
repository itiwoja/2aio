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

// ツール解決: 環境変数が正本。未設定なら PATH の gitleaks を探す（配布先ではどちらも無くてよい）。
function whichGitleaks() {
  if (process.env.GITLEAKS_BIN) return process.env.GITLEAKS_BIN;
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["gitleaks"], { encoding: "utf8" });
  const hit = (probe.stdout || "").split(/\r?\n/).filter(Boolean)[0];
  return hit || null;
}
const GITLEAKS = whichGitleaks();
const SECURITY_SCAN = process.env.SECURITY_SCAN_MJS || null;

// ローカルツールチェーンの回帰テスト — ツールが無い環境（CI / 配布先）ではスキップ。
// GITLEAKS_BIN / SECURITY_SCAN_MJS を明示設定した環境では実在を保証する。
const noGitleaks = !GITLEAKS || !existsSync(GITLEAKS);
const noSecScan = !SECURITY_SCAN;

test("gitleaks 実体が存在する (Step 2.5 の正本スキャナ)", { skip: noGitleaks && "gitleaks 未導入（Step 2.5 はフォールバック運用。GITLEAKS_BIN で指定可）" }, () => {
  assert.ok(existsSync(GITLEAKS), `gitleaks が見つからない: ${GITLEAKS}`);
});

test("security-scan.mjs 実体が存在する (Step 2.5 の SAST)", { skip: noSecScan && "SECURITY_SCAN_MJS 未設定（SAST は任意）" }, () => {
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

test("gitleaks exit code 契約: clean ディレクトリ → 0", { skip: noGitleaks }, () => {
  const dir = mkdtempSync(join(tmpdir(), "gl-clean-"));
  try {
    writeFileSync(join(dir, "app.js"), 'console.log("no secrets here");\n');
    const r = runGitleaks(dir);
    assert.equal(r.status, 0, `clean で exit ${r.status}: ${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gitleaks exit code 契約: ダミー秘密 → 1", { skip: noGitleaks }, () => {
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
