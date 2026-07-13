# Ring 1 — Runtime Guardrails (Claude Code hooks)

These tools intercept the agent's tool calls **before they execute** and block destructive or
secret-leaking actions. They install as Claude Code hooks (`PreToolUse`) — opt-in, so 2AIO is
protected during every session, not only at deploy time.

| Tool | Guards against | Enforcement | License |
|---|---|---|---|
| **agent-guard** | Secret leaks (backed by `gitleaks`+`jq`) | Git hooks + CI + agent hook | MIT |
| **claude-code-safety-net** | Destructive git & filesystem commands | PreToolUse hook (multi-CLI) | MIT |
| **claude-code-safety-guard** | Destructive system ops (3-level override) | PreToolUse hook | MIT |
| **GouvernAI** | Risky ops — auto-approve safe / gate real / block dangerous | Dual enforcement + audit trail | MIT |

## Recommended stack
Layer two complementary guards:
1. **claude-code-safety-net** or **safety-guard** — stops `rm -rf`, `git reset --hard`,
   force-push, and similar irreversible commands.
2. **agent-guard** — stops secrets (API keys, tokens, `service_role`) from being written or
   committed. Needs `gitleaks` + `jq` installed (`brew install gitleaks jq`).

For a policy engine with an audit trail, use **GouvernAI** instead of hand-rolled hooks: it
classifies each action into auto-approve / gate / block (T1–T3 tiers).

## Install (see each upstream repo for exact steps)
The cloned sources are staged at `dev/skills/_review/security-guardrail/<tool>/` (author's local
working area, not present in a clone). Each is a
Claude Code plugin/hook — most install by adding a `PreToolUse` entry to `~/.claude/settings.json`
or via their `install` script. Do **not** wire these to remote one-off package execution;
prefer the repo-local hook script.

Example shape (safety-net style) added to `~/.claude/settings.json`:
```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash",
        "command": "node /path/to/claude-code-safety-net/hook.js",
        "description": "Block destructive git/fs commands" }
    ]
  }
}
```

> Aligns with the IDD guardrail "ECC 本体を上書きしない": these are additive hooks, they do
> not modify existing agents/skills.
