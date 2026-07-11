import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "./router.mjs";

test("mechanical tasks -> haiku", () => {
  assert.equal(classify("find where this function is defined").model, "haiku");
  assert.equal(classify("このファイルをリネームして").model, "haiku");
  assert.equal(classify("format and lint the file").model, "haiku");
});

test("architecture / high-stakes -> opus", () => {
  assert.equal(classify("design the system architecture for auth").model, "opus");
  assert.equal(classify("セキュリティの脆弱性を根本原因から直して").model, "opus");
  assert.equal(classify("large refactor of the whole module").model, "opus");
});

test("ordinary coding -> sonnet (default)", () => {
  assert.equal(classify("add a button to the login form").model, "sonnet");
  assert.equal(classify("write a helper to parse dates").model, "sonnet");
});

test("opus keyword beats haiku keyword", () => {
  // contains both 'search' (haiku) and 'architecture' (opus)
  assert.equal(classify("search the codebase then redesign the architecture").model, "opus");
});

test("many-files signal bumps to opus", () => {
  assert.equal(classify("apply this change across multiple files").model, "opus");
});

test("quick signal pulls default down to haiku", () => {
  assert.equal(classify("quick: add a log line").model, "haiku");
});

test("budget downgrade: opus -> sonnet when block near cap", () => {
  const r = classify("design the architecture", { budgetLeftFraction: 0.1 });
  assert.equal(r.model, "sonnet");
  assert.ok(r.downgraded);
});

test("no downgrade when budget healthy", () => {
  const r = classify("design the architecture", { budgetLeftFraction: 0.9 });
  assert.equal(r.model, "opus");
  assert.equal(r.downgraded, false);
});

test("result always carries a reason", () => {
  const r = classify("anything");
  assert.ok(typeof r.reason === "string" && r.reason.length > 0);
});
