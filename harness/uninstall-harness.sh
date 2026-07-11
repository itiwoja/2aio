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
hooks = cfg.get("hooks", {})

def strip(event, needle):
    arr = hooks.get(event, [])
    kept = []
    for e in arr:
        e["hooks"] = [h for h in e.get("hooks", []) if needle not in h.get("command", "")]
        if e["hooks"]:
            kept.append(e)
    if kept:
        hooks[event] = kept
    else:
        hooks.pop(event, None)

strip("PreToolUse", "command-guard.py")
strip("UserPromptSubmit", "model-advisor.mjs")
strip("UserPromptSubmit", "skill-advisor.mjs")
if "hooks" in cfg and not hooks:
    cfg.pop("hooks")
with open(p, "w", encoding="utf-8") as f: json.dump(cfg, f, indent=2, ensure_ascii=False)
print("  removed 2AIO guard + model-router hooks from settings.json")
PYEOF
echo "✓ Harness disarmed (backup: settings.json.bak-$STAMP). Hook files + rules kept for re-arming."
