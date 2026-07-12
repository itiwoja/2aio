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
- Others: session inherit

### 5. Canonical Output Directory: `2aio-output/`
All 2AIO outputs go to `C:\Users\1kkim\projects\2aio-output\` or equivalent.

### 6. Table Schema is 2aio-planner.md (Single Source of Truth)
The WBS table format in `2aio-planner.md` is canonical. All other files must match.

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

---

## For Complete Documentation

See GitHub: https://github.com/itiwoja/2aio
