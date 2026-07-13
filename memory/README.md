# 2AIO Memory Layer

Persistent, cross-session memory for the agent framework. All options are external tools
(MCP servers / plugins / libraries) — documented and recommended here, not vendored. Sources
staged at `dev/skills/_review/memory/` (+ `dev/skills/TencentDB-Agent-Memory/`) — author's local
working area, not present in a clone.

| Tool | Model | Storage | Interface | Notes |
|---|---|---|---|---|
| **roampal-core** | Outcome-based (good advice promoted, bad demoted) | local | MCP server | `pip install roampal` |
| **selvedge** | Captures the *why* of each change live (git-blame for reasoning) | local SQLite, zero-dep | MCP | Long-term codebase memory |
| **presence** | Per-repo memory + outcome telemetry + calibrated-confidence gate | local, stdlib | MCP + AGENTS.md | Success claims need test evidence; reverts remembered |
| **agentcairn** | Obsidian vault as source of truth | your Obsidian vault | daemonless | **Matches 2AIO's existing Obsidian-compatible `state.md`** |
| **claude-mnemonic** | General memory mgmt/retrieval | local | — | |
| **MAMA** | Decisions + evolution | SQLite + transformers.js embeddings | always-on companion | |
| **callimachus** | Searchable index of agent history (kw + semantic) | local | MCP + CLI + VS Code | Multi-agent (CC/Codex/Cursor/Gemini) |
| **hivemind** | Turns traces into reusable skills | — | — | Feeds back into `skills/` |
| **capy** | Privacy-first context virtualization | local | MCP | Context offload |
| **TencentDB-Agent-Memory** | Layered L0→L3 (Conversation→Atom→Scenario→Persona) + symbolic short-term offload | SQLite+sqlite-vec, optional Tencent VDB | OpenClaw plugin | Biggest system; benchmark gains but OpenClaw-coupled |

## Recommendation for 2AIO
- **Default (zero new infra):** **agentcairn** — it uses an Obsidian vault as the store, which
  is exactly the format 2AIO's `state.md` / `output/` already targets (Markdown を Obsidian vault
  として扱う運用)。Lowest-friction, keeps memory human-readable and git-able.
- **Add outcome-quality gating:** layer **presence** or **roampal-core** so the framework stops
  repeating advice that led to reverts, and success claims require test evidence — this pairs
  naturally with the QA gate in `/2aio-implement-project`.
- **Heavy long-term recall at scale:** **TencentDB-Agent-Memory** if you adopt its OpenClaw
  runtime; otherwise skip (it's coupled to OpenClaw ≥ 2026.3.7).

## How it plugs in
2AIO already persists run state to `output/{project}/state.md`. The memory layer adds
*cross-project* recall: what worked, what was reverted, and reusable learnings — feeding the
IDD Closeout phase (`idd-closeout-collector`) and the board's CMO/CTO context.
