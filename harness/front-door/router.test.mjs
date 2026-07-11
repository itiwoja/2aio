import { test } from "node:test";
import assert from "node:assert/strict";
import { pickLane } from "./router.mjs";

test("business/viability -> board lane", () => {
  assert.equal(pickLane("この副業のビジネスモデルで稼げると思う？").lane, "board");
  assert.equal(pickLane("should i build this startup idea?").lane, "board");
});

test("UI redesign of existing system -> redesign lane", () => {
  assert.equal(pickLane("このダッシュボードのUIを今風に作り直したい").lane, "redesign");
  assert.equal(pickLane("redesign the landing page, it looks dated").lane, "redesign");
});

test("research -> research lane", () => {
  assert.equal(pickLane("競合を調べてまとめて").lane, "research");
  assert.equal(pickLane("do a competitive analysis of note-taking apps").lane, "research");
});

test("ordinary coding / questions -> no lane (null)", () => {
  assert.equal(pickLane("ログイン画面を実装して"), null);
  assert.equal(pickLane("なぜこのバグが起きる？"), null);
  assert.equal(pickLane("短い"), null);
});
