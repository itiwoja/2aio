# Source & Attribution — Guardrail hook

- **Files:** `hooks/command-guard.py`, `bin/grant-override`, `security-operations.md`
- **Vendored into 2AIO from:** https://github.com/inoX-Network/claude-code-safety-guard
- **Author:** inoX-Network — **License:** MIT (2026)

The PreToolUse guard is redistributed unmodified. `security-rules.json` in this
directory is a **2AIO-tuned** ruleset (relaxes routine git staging, keeps only
irreversible/catastrophic operations blocked). Upstream is the source of truth for the hook.
