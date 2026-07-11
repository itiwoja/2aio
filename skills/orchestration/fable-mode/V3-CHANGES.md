# Fable v3 — agent-routed delegation

Response to field feedback on v2 (r/claudeskills, u/Lcatlett1234): telling
Claude in prose to spawn an agent almost always results in the task running
inline on the main thread. Our own testing corroborated it — the v2 fable-opus
run had prose authority to spawn workers and did everything inline.

## What changed

v2: skills carried the whole discipline as prose and *asked* the model to
delegate. v3: delegation is structural.

- **`agents/`** — four real agent definitions with frontmatter (`name`,
  `description`, `tools`, `model`). The discipline moved out of skill prose
  into the agents' system prompts, so it can't be skimmed away.
  - `fable-orchestrator` — Opus, **no Write/Edit tool**. It cannot do the work
    itself; producing an artifact requires spawning a worker by name. Bash
    retained for verification only (known side-door; see limitation in
    fable-opus skill).
  - `fable-worker-sonnet` — reasoning-stage worker, step-3 verification
    enforced hardest.
  - `fable-worker-haiku` — mechanical-stage worker, tightened verification (no
    bare "unverified"), escalate-don't-improvise.
  - `fable-verifier` — read-only cold verifier; gets spec + artifact only,
    never the producer's reasoning.
- **`skills/`** — the four skills shrink to routers: trigger conditions, how to
  brief the named agent, fallback to v2 inline mode when the agents aren't
  installed. Rules are no longer inlined verbatim into briefings — the agent
  definitions carry them.

## Install

Copy `agents/*.md` into `.claude/agents/` (or your plugin's `agents/`
directory) and `skills/*` into your skills directory. The agent names must
surface in the runtime's available agent types for the skills' step 1 check to
pass.

## Evidence base

Benchmarks 2026-07-09/10, n=1 per cell: closed graded tasks showed zero
correctness delta on Opus/Sonnet (they self-verify) and unstable deltas on
Haiku (+25/−17). The measurable win was open-ended research — with the
discipline, Opus pulled and parsed the real NIAAA dataset instead of shipping
invented trend lines. v3 targets the delegation gap, which the benchmark's
prose briefings never enforced. Not yet re-benchmarked.

Companion: `execution-guardrails` skill (unchanged from v2) stays always-on.
