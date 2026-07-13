# Ring 2 — Sandbox & Isolation

Contain the agent so an escaped destructive action or malicious code has bounded blast radius.
These are deployment/runtime options — pick per risk tolerance. Sources staged at
`dev/skills/_review/security-sandbox/` — author's local working area, not present in a clone.

| Tool | Isolation model | Best when | License |
|---|---|---|---|
| **aicontainer** | Devcontainer for Claude Code / Codex in bypass mode | You want auto-approve safely on a project | see upstream |
| **cleat** | One-command Docker sandbox, per-project | Quick host protection, keep host untouched | see upstream |
| **brood-box** | Hardware-isolated microVMs | Stronger-than-container isolation | see upstream |
| **code-on-incus** | Incus VM per agent (root, Docker, systemd) + active defense | Full-fat isolated machine per agent | see upstream |
| **machine** | One Lima VM per GitHub project, signed git | macOS, per-repo VM | see upstream |
| **airut** | Workspace provisioning + container/network sandbox, run from email/Slack | Remote autonomous task execution | see upstream |

## Supporting controls
| Tool | Role |
|---|---|
| **authsome** | Credential gateway — agents authenticate once via OAuth2/API key and never see raw credentials |
| **node9-proxy** | Execution security layer — deterministic "sudo" governance + audit logs for autonomous agents |

## Recommendation for 2AIO
- **Local dev, interactive:** `cleat` (Docker) is the lowest-friction way to keep `--auto`
  runs off your host filesystem.
- **Autonomous / `--auto` batch (`/2aio-autorun-batch`):** run inside `brood-box` or
  `code-on-incus` so a fail-forward run can never touch the host.
- **Secrets:** route all tool credentials through `authsome` so no key ever lands in agent
  context (complements Ring-1 secret guards).
