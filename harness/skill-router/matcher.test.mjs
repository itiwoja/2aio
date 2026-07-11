import { test } from "node:test";
import assert from "node:assert/strict";
import { match, expandPrompt } from "./matcher.mjs";

// Small synthetic index so the test doesn't depend on installed skills.
const INDEX = {
  skills: [
    { name: "redesign-existing-projects", description: "upgrade existing UI", keywords: [
      { term: "redesign", w: 2 }, { term: "ui", w: 1.5 }, { term: "design", w: 1 }, { term: "existing", w: 1 } ] },
    { name: "security-and-hardening", description: "harden code", keywords: [
      { term: "security", w: 2 }, { term: "hardening", w: 1.5 }, { term: "vulnerability", w: 1 } ] },
    { name: "review-swarm", description: "parallel review", keywords: [
      { term: "review", w: 2 }, { term: "swarm", w: 1.5 }, { term: "parallel", w: 1 }, { term: "multi-agent", w: 1 } ] },
    { name: "test-driven-development", description: "tests first", keywords: [
      { term: "test", w: 2 }, { term: "tdd", w: 1.5 } ] },
  ],
};
const SYN = { "作り直": ["redesign"], "セキュリティ": ["security"], "並列": ["parallel", "multi-agent", "review"] };

test("English prompt matches by keyword", () => {
  const r = match("please review this security change", INDEX, { synonyms: {} });
  const names = r.map((x) => x.name);
  assert.ok(names.includes("security-and-hardening"));
  assert.ok(names.includes("review-swarm"));
});

test("Japanese prompt matches English skill via synonyms", () => {
  const r = match("UIを作り直して", INDEX, { synonyms: SYN });
  assert.equal(r[0].name, "redesign-existing-projects");
});

test("synonym expansion appends english terms", () => {
  const ex = expandPrompt("セキュリティ", SYN);
  assert.ok(ex.includes("security"));
});

test("below-threshold prompts return nothing", () => {
  const r = match("hello there friend", INDEX, { synonyms: {} });
  assert.equal(r.length, 0);
});

test("results are ranked by score desc and capped at topN", () => {
  const r = match("security review test redesign", INDEX, { synonyms: {}, topN: 2 });
  assert.equal(r.length, 2);
  assert.ok(r[0].score >= r[1].score);
});

test("each hit reports which keywords matched", () => {
  const r = match("security", INDEX, { synonyms: {} });
  assert.ok(Array.isArray(r[0].hits) && r[0].hits.includes("security"));
});
