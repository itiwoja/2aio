# 2AIO Live Harness

Makes every Claude Code session **run on 2AIO** — not just a set of installable files, but an
operating layer with four parts:

1. **Guardrails wired** — a `PreToolUse` hook intercepts every Bash/Write/Edit/MultiEdit/NotebookEdit
   call and blocks irreversible/catastrophic actions before they run.
2. **Per-agent + dynamic model routing** — each 2aio agent pins the right model tier (opus / sonnet /
   haiku), and the `model-router` picks a tier dynamically from the task at the launch boundary.
3. **Skill auto-trigger + delegation** — the 66 vendored skills auto-activate by description; the
   board/engineering agents are delegated to by role.
4. **Codex delegation** — Claude plans, then delegates implementation to the cheaper Codex
   (Terra/Luna) family via `codex-router/`, keeping expensive Claude tokens for judgment.

## Arm / disarm

```bash
bash harness/install-harness.sh      # arm: backs up settings.json, merges the guard hooks
bash harness/uninstall-harness.sh    # disarm: removes the hooks (keeps files for re-arming)
```
PowerShell equivalent: `./install-harness.ps1`.

The installer is **idempotent and non-destructive**: it backs up `settings.json`, and only
*merges* `hooks.PreToolUse` (never overwrites your other settings). It uses `python` (the Windows
Store `python3` is a broken stub).

## Ring-1 guard (what gets blocked)

Source hook: [inoX-Network/claude-code-safety-guard](https://github.com/inoX-Network/claude-code-safety-guard)
(MIT), with a **2AIO-tuned** `security-rules.json`. Philosophy: block only what is **irreversible**,
so the guard stays armed instead of being disabled for friction.

| Blocked (exit 2) | Allowed (normal flow) |
|---|---|
| `rm -rf /`, `~`, `$HOME`, `/*` | `git add -A`, `git add .`, `git commit`, `--amend` |
| `git reset --hard`, `git clean -fd` | `git push` to feature branches |
| `git commit --no-verify` (skips hooks) | `npm/pip/cargo install` |
| `git push --force` to **main/master** | force-push to feature branches |
| `mkfs`, `dd of=/dev/sd*`, fork bomb, `curl … \| sh` | chained safe commands |
| writes to `~/.ssh`, `~/.gnupg`, system dirs | reading normal project files |
| reads of `.env`, `~/.aws/credentials` (override 1+) | reading `~/.ssh/config`, `*.pub` |

**Owner bypass:** prefix a command with `!` in the Claude Code prompt — that runs it as *you*, not
the agent, and the guard does not apply. Fail-safe: a missing rules file falls back to a conservative
hardcoded set (never blocks everything); malformed hook input exits 0 (allow).

Tune blocks in `~/.claude/safety-guard/security-rules.json` (installed copy) — the repo copy is the
template.

## Per-agent model routing

| Tier | Agents | Rationale |
|---|---|---|
| **opus** | `2aio-ceo`, `2aio-cto` | Final judgment / architecture & tech decisions |
| **sonnet** | `2aio-cfo`, `2aio-cmo`, `2aio-cso`, `2aio-planner`, `2aio-prd`, `2aio-engineer`, `2aio-qa`, `2aio-devops` | Analysis, planning, main implementation |
| **haiku** | `2aio-researcher` + 6 search specialists (`2aio-r-*`) | High-frequency, context-isolated lookups (3× cheaper) |

Set in each agent's `model:` frontmatter; `install.sh` deploys them. Matches the cost policy in
`~/.claude/CLAUDE.md`.

### Automatic model switching (`model-router/`)

Beyond the *static* per-agent pins, the router picks a model **dynamically from the task**.
Grounded constraint: **Claude Code hooks cannot switch the model** (no `model` field in hook
output), and there is no built-in auto-routing. So auto-switching happens where it genuinely can —
at the launch/orchestration boundary — plus an advisory nudge mid-session.

| Surface | Mechanism | Automatic? |
|---|---|---|
| **Launcher** `2aio-run.sh` / `.ps1` | classifies the task, then `claude --model <picked> …` | ✅ real switch at launch |
| **Orchestrators** (`/2aio-build`, batch, forge) | call `pick.mjs` to choose `--model` per phase/job | ✅ real switch per job |
| **Advisor hook** (`model-advisor.mjs`, UserPromptSubmit) | injects `additionalContext` recommending `/model X` when a clearly cheaper/stronger tier fits | ⚠️ advisory only (hooks can't switch) |

Routing (rules in `model-router/routing-rules.json`, tune freely):
- **haiku** — mechanical/lookup/status (search, rename, format, "確認だけ")
- **opus** — architecture / security / large multi-file / high-stakes judgment
- **sonnet** — default (ordinary coding)
- **budget-aware** — pass `MODEL_ROUTER_BUDGET=0..1` (remaining 5h-block fraction); below 15 % it
  downgrades a tier to protect the subscription quota.

```bash
2aio-run "refactor the whole auth system"   # -> claude --model opus
2aio-run "rename these files"                # -> claude --model haiku
2aio-run --why "design the architecture"     # show pick + reason, don't launch
node model-router/pick.mjs "quick: add a log"  # -> haiku   (for scripts/orchestrators)
```
Tests: `cd model-router && node --test` (9 cases). The advisor is wired by `install-harness.sh`
and fails open (never blocks prompt submission).

## Automatic skill selection (`skill-router/`)

Skills only help if they actually fire. Claude's native skill auto-invocation is description-
driven and often misses — especially for **Japanese prompts against English-described skills**.
The skill-router closes that gap: a UserPromptSubmit hook detects which installed skills match the
prompt and injects a directive to invoke them via the Skill tool.

| Piece | Role |
|---|---|
| `build-index.mjs` | scans `~/.claude/skills/*/SKILL.md`, builds a weighted keyword index (name + trigger phrases + description). Run by the installer; re-run after adding skills. |
| `matcher.mjs` | pure ranker: prompt → top-N skills, with **JP→EN synonym expansion** (`synonyms.json`) so 「UIを作り直して」 matches `redesign-existing-projects`. |
| `skill-advisor.mjs` | UserPromptSubmit hook: injects `[2AIO skill-router] matches: <skills> — invoke via Skill tool`. Silent when nothing matches; fail-open. |

Tune matching entirely in data: `synonyms.json` (JP↔EN terms) and `routing` weights in
`build-index.mjs`. Tests: `cd skill-router && node --test`.

Examples (live): 「このダッシュボードUIを作り直したい」→ `redesign-existing-projects, styleseed-design-review`;
「多エージェントで並列レビュー」→ `review-swarm, agent-task-splitter`; 「セキュリティを強化」→ `security-and-hardening`.

> Like the model advisor, this **cannot invoke the skill itself** (hooks can't call tools) — it
> injects a strong directive so the assistant reliably reaches for the right skill instead of
> ignoring it. Re-run `install-harness.sh` after installing new skills to refresh the index.

## Codex delegation (`codex-router/`)

**Claude thinks, Codex writes.** Expensive Claude (Fable/Opus) tokens go to *planning, review,
and integration*; mechanical-to-mid implementation is delegated to the cheaper Codex (Terra/Luna)
family via `codex exec`. Same quality, far fewer Claude tokens.

| Piece | Role |
|---|---|
| `routing-rules.json` | maps a task → cheapest fitting Codex tier. **Default Terra**; Luna for mechanical/bulk; **Sol only when explicitly hard** (expensive). JP+EN keyword rules — tune freely. |
| `codex-router.mjs` / `pick-codex.mjs` | pure classifier: `classify(task) → {model, tier, reason}`. CLI prints the model id (`--json` for full result). |
| `codex-run.sh` | safe wrapper around `codex exec`. Auto-picks the model (`--why` to preview), enforces every codex-exec safety rule: stdin closed (`< /dev/null`, no hang), 10 MB log cap (prevents runaway logs), `-o` structured jsonl, `read-only` sandbox by default (`--write` = workspace-write), `--bg` background. |
| `/2aio-delegate` command | orchestrates the flow: Fable/Opus plans thoroughly → writes `.ai/codex_brief_*.md` → delegates impl to Codex → Claude reviews & integrates. For ≥2 parallel subtasks it invokes **agent-task-splitter** (`.coord/plan.yml` + disjoint `files_in_scope`) instead of hand-rolling briefs. |
| `codex-advisor.mjs` (UserPromptSubmit) | **auto-delegation** — detects an implementation task from a plain prompt (`delegate-intent.mjs` + `delegate-rules.json`, JP+EN) and injects a strong directive telling the assistant to delegate the coding to Codex rather than hand-writing it. This is what makes delegation fire *without* the user typing `/2aio-delegate`. Advisory (hooks can't force the model); questions/reviews/trivial edits are excluded and stay inline. |

```bash
codex-run.sh --why "scaffold boilerplate tests"   # -> gpt-5.6-luna  (mechanical)
codex-run.sh --why "implement the login form"      # -> gpt-5.6-terra (default)
codex-run.sh --why "tricky race condition fix"      # -> gpt-5.6-sol   (explicitly hard)
codex-run.sh --write --bg -C <repo> "<planned task>"  # real delegated impl, background
```

Tests: `cd codex-router && node --test` (6 cases: default→terra, mechanical→luna, hard→sol,
ordinary-never-sol). The global Codex default is also set to Terra in `~/.codex/config.toml`
(`model = "gpt-5.6-terra"`), so even a bare `codex` call avoids the expensive Sol tier.

### Audit trail — proving 2AIO + Claude→Codex were used

Two append-only JSONL logs let you verify *after the fact* that the harness and the
delegation actually fired (not just claimed to):

| Log | Written by | Proves |
|---|---|---|
| `~/.claude/.agent-audit/actions.jsonl` | the guard (`command-guard.py`) on **every** Bash/Read/Write/Edit/MCP call | **2AIO was active** — every tool call is recorded with actor, target, allow/block, reason. Secrets are redacted. |
| `~/.claude/logs/2aio-usage.jsonl` | `codex-run.sh` on every delegation | **Claude→Codex ran** — one `codex_delegate_start` line (written *before* codex launches, so it survives a kill) + one `codex_delegate_end` line with model, tier, sandbox, dir, task, result path, exit code. |

Override the delegation log path with `AIO_USAGE_LOG`. Quick check after a run:
`tail -n 5 ~/.claude/logs/2aio-usage.jsonl`.

**Safety:** never put strong-permission secrets (e.g. `service_role`) in a Codex brief or the
chat — pass env-var *names* only. Codex output is always reviewed by Claude before integration;
destructive ops are never delegated.

## Cost / latency note
The guard spawns `python` on every intercepted tool call (~100–200 ms). That is the price of a
live guardrail. Scope is Bash/Write/Edit/MultiEdit/NotebookEdit (Read and MCP are not intercepted,
to keep sessions fast).
