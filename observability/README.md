# 2AIO Observability Layer

See what the agents are actually doing — tool calls, subagent trees, token/cost per session.
External tools; documented and recommended here, not vendored. Sources staged at
`dev/skills/_review/observability/` — author's local working area, not present in a clone.

| Tool | Stack | Surfaces | Notes |
|---|---|---|---|
| **agents-observe** | Plugin + React UI + Dockerized SQLite | Full session lifecycle, parent/subagent hierarchy, session replay, per-model token stats | Installs as a plugin, hooks across lifecycle |
| **Claude-Code-Agent-Monitor** | Node/Express + React + SQLite + MCP + VS Code + desktop | Live sessions, subagent orchestration trees, tool-call timelines | Loopback-only, data stays local |
| **claude-code-otel** | OpenTelemetry → Grafana (Docker) | Session activity, performance, token usage, cost in prebuilt dashboards | Implements Anthropic's observability guidance |
| **multi-agent-observability** | Bun + SQLite + WebSocket + Vue | Hook events across concurrent agents, task handoffs, live filtering | Good fit for `/2aio-autorun-batch` |

## Recommendation for 2AIO
- **Multi-repo control plane already exists** (`control.mjs`, port 7900) showing the 5-hour
  subscription budget. Observability complements it with *per-agent* tracing.
- **Default:** **agents-observe** or **Claude-Code-Agent-Monitor** — both hook the full
  lifecycle and give a subagent tree, which is exactly what the board-of-directors +
  engineer/qa/devops fan-out produces. Pick Agent-Monitor if you want the VS Code/desktop
  companions; agents-observe for the lighter plugin.
- **Cost/token governance:** **claude-code-otel** (Grafana) pairs with the existing `governor`
  (`lib/governor.mjs`) — the governor *enforces* the budget, otel *visualizes* it over time.
- **Batch autonomous runs:** **multi-agent-observability** (WebSocket live view) is built for
  watching many concurrent agents, matching `/2aio-autorun-batch`.

## How it plugs in
These read Claude Code's native hook events, so they observe every 2aio-* agent and skill with
no framework changes. Wire one via `~/.claude/settings.json` hooks; the control plane and the
observability dashboard then cover *budget* and *behavior* respectively.
