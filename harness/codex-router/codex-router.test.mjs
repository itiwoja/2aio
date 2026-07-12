import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "./codex-router.mjs";

test("default is terra (not sol)", () => {
  const r = classify("implement the login form component");
  assert.equal(r.tier, "terra");
  assert.equal(r.model, "gpt-5.6-terra");
});

test("mechanical/bulk -> luna", () => {
  assert.equal(classify("scaffold boilerplate tests for the api").tier, "luna");
  assert.equal(classify("一括でリネームして整形").tier, "luna");
  assert.equal(classify("find and replace across the codebase").model, "gpt-5.6-luna");
});

test("explicitly hard -> sol", () => {
  assert.equal(classify("fix the tricky race condition in the scheduler").tier, "sol");
  assert.equal(classify("複雑なアルゴリズムを実装").model, "gpt-5.6-sol");
});

test("many-files signal from default -> luna (bulk)", () => {
  assert.equal(classify("apply this across multiple files").tier, "luna");
});

test("never returns sol for ordinary work", () => {
  for (const t of ["add a button", "write a util", "implement CRUD endpoints"]) {
    assert.notEqual(classify(t).tier, "sol");
  }
});

test("always resolves a concrete model id", () => {
  const r = classify("anything at all");
  assert.match(r.model, /^gpt-5\.6-(luna|terra|sol)$/);
});
