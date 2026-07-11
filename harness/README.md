# 2AIO Live Harness

Makes every Claude Code session **run on 2AIO** — not just a set of installable files, but an
operating layer with three parts:

1. **Guardrails wired** — a `PreToolUse` hook intercepts every Bash/Write/Edit/MultiEdit/NotebookEdit
   call and blocks irreversible/catastrophic actions before they run.
2. **Per-agent model routing** — each 2aio agent pins the right model tier (opus / sonnet / haiku)
   for cost-vs-quality (see table below and each agent's frontmatter).
3. **Skill auto-trigger + delegation** — the 66 vendored skills auto-activate by description; the
   board/engineering agents are delegated to by role.

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

## Cost / latency note
The guard spawns `python` on every intercepted tool call (~100–200 ms). That is the price of a
live guardrail. Scope is Bash/Write/Edit/MultiEdit/NotebookEdit (Read and MCP are not intercepted,
to keep sessions fast).
