# 2AIO Live Harness

Makes every Claude Code session **run on 2AIO** — not just a set of installable files, but an
operating layer with four parts:

1. **Guardrails wired** — a `PreToolUse` hook intercepts every Bash/Write/Edit/MultiEdit/NotebookEdit
   call and blocks irreversible/catastrophic actions before they run.
2. **Per-agent + dynamic model routing** — each 2aio agent pins the right model tier (opus / sonnet /
   haiku), and the `model-router` picks a tier dynamically from the task at the launch boundary.
3. **Skill auto-trigger + delegation** — the 66 vendored skills auto-activate by description; the
   board/engineering agents are delegated to by role.
4. **Codex delegation (enforced)** — Claude plans and commands; implementation is delegated to the
   cheaper Codex (Terra/Luna) family via `codex-router/`. A PreToolUse enforcer blocks Claude from
   hand-typing bulk new code, so the commander/implementer split is real, not just advised.

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
| `codex-run.sh` | safe wrapper around `codex exec`. Auto-picks the model (`--why` to preview), enforces every codex-exec safety rule: stdin closed (`< /dev/null`, no hang), 10 MB log cap (prevents runaway logs), `-o` structured jsonl, `read-only` sandbox by default (`--write` = workspace-write), `--bg` background. **Refuses by default when no `.ai/codex_brief_*.md` plan exists** (`AIO_REQUIRE_BRIEF=0` allows a quick one-off without one) and records `brief_present` in the usage log — so planning is guaranteed, not just nudged. The usage log line is emitted by node so multibyte (JP) tasks stay valid UTF-8. |
| `/2aio-delegate` command | orchestrates the flow: **plan via the `2aio-planner` sub-agent** (Claude, as commander, reviews it and fills in measurable acceptance criteria + resolved edge cases + conventions) → write `.ai/codex_brief_<slug>.md` → delegate impl to Codex → Claude reviews against the criteria & integrates. For ≥2 parallel subtasks it invokes **agent-task-splitter** (`.coord/plan.yml` + disjoint `files_in_scope`). The plan is not improvised: a sub-agent drafts it, the strong model hardens it. |
| `codex-advisor.mjs` (UserPromptSubmit) | **auto-delegation** — detects an implementation task from a plain prompt (`delegate-intent.mjs` + `delegate-rules.json`, JP+EN) and injects a strong directive to plan (via `2aio-planner`) then delegate the coding to Codex rather than hand-writing it. Fires *without* the user typing `/2aio-delegate`. **For UI tasks it appends a design-quality directive**: the brief must commit to one opinionated style direction (brutalism/editorial/glass/…) with intentional palette, type pairing, spacing rhythm, depth, and hover/focus/active states — never a generic Tailwind/AI template — planned with the `styleseed-design-review` / `ui-craft` / `anti-ai-design` skills. Advisory; questions/reviews/trivial edits stay inline. |

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

### Hard enforcement — Claude commands, Codex implements (`enforce/`)

The advisors *nudge*; this *enforces*. `delegation-enforcer.py` is a PreToolUse hook (Write only)
that blocks the one action that breaks the operating model — **Claude writing a substantial new
implementation file itself** — and tells it to delegate that file to Codex. It is deliberately
narrow so Claude keeps its **commander** role (plan → drive Codex → review → integrate):

| Blocked (exit 2) | Always allowed |
|---|---|
| `Write` of a **new code file** ≥ `min_lines` (40) with a code extension | `Edit`/`MultiEdit` on existing files (review, integration, fixes) |
| e.g. a from-scratch `app.js`, `index.html`, component, endpoint | planning docs (`.md`, `.ai/`, `.coord/`), config/data (`.json`, `.yml`) |
| | small/critical files (< 40 lines), tests (`*.test.*`), the 2AIO repo, scratchpad |

So Claude still plans, reviews, and does surgical edits — it just can't hand-type the bulk build.
Rules/thresholds live in `enforce/enforce-rules.json` (tune the extension set, `min_lines`, and
allow-lists). Turn it off with `enabled: false` or `touch ~/.claude/.2aio-enforce-off`; one-off
bypass via the owner `!` prefix. Tested (8 cases: blocks big new .js/.html, allows edits/docs/
config/small/tests/repo).

## Front-door routing (`front-door/`) — 2AIO fires without a `/2aio-*` command

The advisors above cover *how* to do a task (model tier, skills, delegate the coding). The
front-door covers *which 2AIO pipeline* a request belongs to, so the right heavy machinery
engages from a plain prompt instead of an ad-hoc answer.

| Lane | Trigger (JP+EN, tunable in `routes.json`) | Directs to |
|---|---|---|
| **board** | business idea / viability / revenue / 稼ぐ / 事業 / マネタイズ | `/2aio-start-project` (取締役会: CEO/CFO/CMO/CTO/CSO → PRD) |
| **redesign** | 作り直し / リデザイン / modernize the UI / restyle | `/2aio-redesign` (audit & improve existing UI in place) |
| **research** | 競合調査 / 市場調査 / competitive analysis / research the… | `2aio-researcher` + `2aio-r-*` specialists |

`2aio-advisor.mjs` (UserPromptSubmit) picks at most one lane (priority = file order) and injects a
directive to use it. It deliberately has **no generic build/implement lane** — that is owned by
`codex-advisor` (delegation), so the four advisors never fight over the same prompt:

| Advisor | Owns |
|---|---|
| `model-advisor` | which model tier |
| `skill-advisor` | which installed skill |
| `codex-advisor` | delegate the *implementation* to Codex |
| `2aio-advisor` (front-door) | which *2AIO pipeline* (board / redesign / research) |

All four are advisory (hooks can't call tools or force the model) and fail open. For a hard,
always-in-context "operate on 2AIO" rule, add a standing instruction to `~/.claude/CLAUDE.md` — that
file is guard-protected, so only the owner can edit it via `!`.

## Cost / latency note
The guard spawns `python` on every intercepted tool call (~100–200 ms). That is the price of a
live guardrail. Each UserPromptSubmit advisor spawns `node` once per prompt; all four fail open. Scope is Bash/Write/Edit/MultiEdit/NotebookEdit (Read and MCP are not intercepted,
to keep sessions fast).
