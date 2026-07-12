# 2AIO Architecture & Design Decisions

**2AIO (AGENT ALL IN ONE)** は Claude Code の capabilities を最大限活用するマルチエージェント・オーケストレーション・フレームワークです。

## 6 Core Design Principles

### 1. Orchestrator-Mediated Research Delegation
Research is always mediated by the main thread. Subagents cannot spawn other subagents.

### 2. Deployment Approval via state.md Only
Deployment approval is recorded in `state.md` by the orchestrator BEFORE devops is invoked. Devops trusts only the `deploy_approved: true` field.

### 3. Security Gate is devops Step 2.5 (Single Source of Truth)
gitleaks + SAST scanning happens exactly once, in `2aio-devops` Step 2.5. Never bypassed, even in auto mode.

### 4. Model Distribution (Cost Optimization)
- CEO: opus (strategic judgment)
- Research agents (7): haiku (3x cheaper, mechanical API calls)
- Implementation trio (engineer / qa / devops): sonnet **pinned** — never session-inherit.
  A haiku session must not run implementation/QA judgment; an opus session must not waste budget on them.
- Others: session inherit

### 5. Canonical Output Directory: `2aio-output/`
All 2AIO outputs go to `C:\Users\1kkim\projects\2aio-output\` or equivalent.

### 6. Table Schema is 2aio-planner.md (Single Source of Truth)
The WBS table format in `2aio-planner.md` is canonical. All other files must match.

### 7. Commander Plans, Cheap Models Implement (Live Harness)
The strong model (Claude) is the **commander** — it plans, reviews, integrates, and judges. Bulk
typing (implementation) is delegated to cheaper models/AIs (Codex Terra/Luna, or any OpenAI-compatible
provider). This split is not just advised: a PreToolUse **enforcer** blocks Claude from hand-writing
substantial *new* code files, while always allowing edits, planning, and review — so the commander
role stays intact. The delegation flow is always **plan → write `.ai/codex_brief_*.md` → delegate →
review against acceptance criteria → integrate**; `codex-run.sh` refuses to delegate without a brief,
so planning is guaranteed. Model/provider selection (mechanical→cheapest, ordinary→mid, hard→top only
when explicitly hard) and the full mechanism live in [`harness/README.md`](./harness/README.md); the
host-agnostic operating manual is [`AGENTS.md`](./AGENTS.md).

### 8. Secrets: env-var names only, never in chat or briefs
Strong-permission tokens (e.g. `service_role`) are never pasted into chat, logs, or Codex briefs —
only env-var *names* are passed. Delegated output is always reviewed by Claude before integration;
destructive/outward-facing ops are never auto-delegated.

---

## Usage Lanes

### Full Board (フル取締役会)
```bash
/2aio-start-project "テーマ"
```
→ Takes 30-60 min, outputs PRD + board meeting report

### Lightweight (軽量モード)
```bash
/2aio-start-project "テーマ" --lite
```
→ Takes 10 min, CTO + CEO only, no research

### Implementation
```bash
/2aio-implement-project {impl-plan-file}
```
→ Executes sprints, outputs code + deployment URL

### Fast Build (高速レーン)
```bash
/2aio-build "テーマ" --auto
```
→ spec → design → code → publish in ~2 hours

### Batch Automation
```bash
/2aio-autorun-batch テーマ1 テーマ2 テーマ3
```
→ Unattended: board → plan → implement → deploy

### Delegate (司令塔 → Codex 実装)
```bash
/2aio-delegate "<実装タスク>"
```
→ Claude plans + writes a brief → Codex implements → Claude reviews & integrates (see Principle 7)

### Harden (既存システムの自律強化)
```bash
/2aio-harden [--dimensions=security,a11y,...]
```
→ Audit → parallel multi-dimension review → fix CRITICAL/HIGH via Codex (test-green verified) →
re-audit, loop until clean

### Redesign (既存 UI の作り直し)
```bash
/2aio-redesign
```
→ Audit & improve an existing UI in place with the design-quality skills

---

## For Complete Documentation

See GitHub: https://github.com/itiwoja/2aio
