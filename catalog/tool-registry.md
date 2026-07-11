# 2AIO Tool Registry — the "AGENT ALL IN ONE" index

Everything 2AIO integrates, by domain. Three integration tiers:

- **Vendored** — shipped inside this repo (`skills/`), installed to `~/.claude/skills/`.
- **Wired** — external tool with an integration wrapper/hook/doc here; installed via its own
  package manager and invoked by 2AIO.
- **Catalogued** — known, invokable, documented for reach-when-needed, but not part of the
  default install (see [`security-tools.md`](security-tools.md) for the external-tool universe).

## Agents (native 2AIO) — Vendored
17 board + engineering agents (`agents/`) and 5 workflow commands (`commands/`). See top-level
`README.md`.

## Skills — Vendored (66)
| Domain | Count | Dir | Source |
|---|---|---|---|
| SDLC workflow | 24 | `skills/sdlc/` | addyosmani/agent-skills |
| Apple / Swift | 9 | `skills/apple/` | Dimillian/Skills |
| Engineering | 7 | `skills/engineering/` | Dimillian/Skills |
| Design / UI | 17 | `skills/design/` | taste-skill, styleseed, ui-craft |
| Orchestration | 8 | `skills/orchestration/` | agent-collab-skills, fable-mode |
| Research | 1 | `skills/research/` | last30days-skill |
| Design refs | — | `skills/design-references/` | awesome-design-md-jp (template+samples) |

Full attribution: [`../skills/SOURCES.md`](../skills/SOURCES.md).

## Security — Wired (4 rings)
| Ring | Tools | Dir |
|---|---|---|
| Guardrails | agent-guard, claude-code-safety-net, claude-code-safety-guard, GouvernAI | `security/guardrails/` |
| Sandbox | aicontainer, cleat, brood-box, code-on-incus, machine, airut, authsome, node9-proxy | `security/sandbox/` |
| Scanners | Bearer, Checkov, KICS, Insider, Keyscope, is-website-vulnerable, pompelmi, recon, react2shell-scanner, shai-hulud-scanner | `security/scanners/` |
| Skill integrity | SkillSpector, SkilLock | `security/skill-integrity/` |

External security-tool universe (network/endpoint/threat-intel/red-blue-team/forensics/…):
[`security-tools.md`](security-tools.md).

## Memory — Wired
agentcairn (default, Obsidian), presence, roampal-core, selvedge, claude-mnemonic, MAMA,
callimachus, hivemind, capy, TencentDB-Agent-Memory. → `memory/README.md`.

## Observability — Wired
agents-observe, Claude-Code-Agent-Monitor, claude-code-otel, multi-agent-observability.
→ `observability/README.md`.

## Self-improvement — Native
2AIOForge (`run.mjs` + `lib/`) — collect → synthesize (local Ollama) → audit → apply/propose,
auto-updating design/security knowledge. A multi-repo control plane (`control.mjs`, subscription
budget governor) lives on branch `claude/repos-consolidation-ccc-5e5933` and merges in cleanly.
See top-level `README.md` Part 5.

## Staging
All cloned upstream sources are staged (git-ignored) at `dev/skills/_review/<category>/<repo>/`
so any tool can be inspected, updated, or promoted from Catalogued → Wired without re-cloning.
