# 2AIO Security Layer

Defense-in-depth for an autonomous agent framework. Four rings, outermost first:

```
┌─ 1. GUARDRAILS ── block destructive/leaky actions before they run (Claude Code hooks)
│  ┌─ 2. SANDBOX ── contain the agent (container / VM / proxy) so blast radius is bounded
│  │  ┌─ 3. SCANNERS ── SAST / secret / IaC / supply-chain scans on the code 2AIO writes
│  │  │  ┌─ 4. SKILL INTEGRITY ── verify the skills 2AIO *itself* runs are not malicious/drifted
│  │  │  └─────────────────────────────────────────────────────────────────
```

| Ring | Directory | What it does | Tools integrated |
|---|---|---|---|
| 1. Guardrails | [`guardrails/`](guardrails/) | Intercept risky tool calls (destructive git/fs, secret leaks) via Claude Code hooks | agent-guard, claude-code-safety-net, claude-code-safety-guard, GouvernAI |
| 2. Sandbox | [`sandbox/`](sandbox/) | Run the agent in hardware/OS isolation | aicontainer, brood-box, cleat, code-on-incus, machine, authsome, node9-proxy |
| 3. Scanners | [`scanners/`](scanners/) | Scan generated code before commit/deploy | Bearer, Checkov, KICS, Insider, Keyscope, is-website-vulnerable, pompelmi, recon, react2shell-scanner, shai-hulud-scanner |
| 4. Skill integrity | [`skill-integrity/`](skill-integrity/) | Audit & pin the framework's own skills | SkillSpector (NVIDIA), SkilLock |

## Design principle
2AIO **does not vendor these tools' source** — they are installed via their own package
managers/binaries and invoked as external processes. This directory ships the *integration*:
install notes, invocation wrappers, hook templates, and the policy for when each runs. See
[`../catalog/security-tools.md`](../catalog/security-tools.md) for the full registry, including
external tools that are catalogued (invokable) but not part of the default install.

## Where this plugs into the pipeline
- `/2aio-build` and `/2aio-implement-project` already run a **pre-deploy security gate**
  (gitleaks + SAST). This layer *expands* that gate: `scanners/scan.sh <dir>` runs every
  installed scanner and aggregates findings.
- Guardrail hooks are opt-in (`guardrails/install-hooks.md`) so the agent is protected during
  every session, not only at deploy time.
- CI can run `skill-integrity/` checks so a poisoned upstream skill update is caught on pull.
