import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldDelegate } from "./delegate-intent.mjs";

test("build/implement prompts -> delegate", () => {
  assert.equal(shouldDelegate("地図アプリを作って").delegate, true);
  assert.equal(shouldDelegate("implement a login component with validation").delegate, true);
  assert.equal(shouldDelegate("TODOアプリのCRUD機能を実装して").delegate, true);
});

test("questions / review / explain -> stay inline", () => {
  assert.equal(shouldDelegate("なぜこのバグが起きるのか説明して").delegate, false);
  assert.equal(shouldDelegate("review this code for security issues").delegate, false);
  assert.equal(shouldDelegate("how does the auth flow work?").delegate, false);
});

test("trivial / too short -> stay inline", () => {
  assert.equal(shouldDelegate("直して").delegate, false);
  assert.equal(shouldDelegate("fix the typo in the header").delegate, false);
});

test("exclusion wins over implement keyword", () => {
  // has 'アプリ' (implement) but also 'レビュー' (exclude) -> inline
  assert.equal(shouldDelegate("このアプリをレビューして").delegate, false);
});

test("UI tasks are flagged (ui != null) so a design-quality plan is required", () => {
  assert.ok(shouldDelegate("ダッシュボードUIを作って").ui);
  assert.ok(shouldDelegate("build a landing page").ui);
  assert.ok(shouldDelegate("TODOアプリを作って").ui);
});

test("non-UI implementation is not flagged as UI", () => {
  const r = shouldDelegate("CSVをパースするスクリプトを実装して");
  assert.equal(r.delegate, true);
  assert.equal(r.ui, null);
});
