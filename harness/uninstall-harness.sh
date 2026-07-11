#!/usr/bin/env bash
# 2AIO Live Harness uninstaller — removes the guardrail PreToolUse hooks from
# settings.json (keeps the hook file + rules on disk so re-arming is instant).
set -euo pipefail
CLAUDE_DIR="$HOME/.claude"
SETTINGS="$CLAUDE_DIR/settings.json"
[ -f "$SETTINGS" ] || { echo "no settings.json"; exit 0; }
PYBIN="python"; command -v python >/dev/null 2>&1 || PYBIN="python3"
STAMP="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo bak)"
cp "$SETTINGS" "$SETTINGS.bak-$STAMP"

SETTINGS="$SETTINGS" "$PYBIN" - <<'PYEOF'
import json, os
p = os.environ["SETTINGS"]
with open(p, encoding="utf-8") as f: cfg = json.load(f)
pre = cfg.get("hooks", {}).get("PreToolUse", [])
kept = []
for e in pre:
    e["hooks"] = [h for h in e.get("hooks", []) if "command-guard.py" not in h.get("command", "")]
    if e["hooks"]:
        kept.append(e)
if "hooks" in cfg:
    if kept:
        cfg["hooks"]["PreToolUse"] = kept
    else:
        cfg["hooks"].pop("PreToolUse", None)
        if not cfg["hooks"]:
            cfg.pop("hooks")
with open(p, "w", encoding="utf-8") as f: json.dump(cfg, f, indent=2, ensure_ascii=False)
print("  removed 2AIO guard hooks from settings.json")
PYEOF
echo "✓ Harness disarmed (backup: settings.json.bak-$STAMP). Hook file + rules kept for re-arming."
