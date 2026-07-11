#!/usr/bin/env bash
# 2AIO Live Harness installer — arms the guardrail hook + supporting dirs.
# Idempotent, non-destructive: backs up settings.json, merges (never overwrites) the
# PreToolUse hooks. Uses `python` (NOT python3 — the Windows Store python3 is a stub).
set -euo pipefail

CLAUDE_DIR="$HOME/.claude"
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -d "$CLAUDE_DIR" ] || { echo "Claude Code not found at $CLAUDE_DIR"; exit 1; }

# python resolution: prefer a real python (the WindowsApps python3 shim is broken)
PYBIN="python"
command -v python >/dev/null 2>&1 || PYBIN="python3"
"$PYBIN" -c "import sys" 2>/dev/null || { echo "No working python found"; exit 1; }

echo "=== 2AIO Live Harness install ==="

# 1. directories
mkdir -p "$CLAUDE_DIR/hooks" "$CLAUDE_DIR/safety-guard" "$CLAUDE_DIR/bin" \
         "$CLAUDE_DIR/.sudo-overrides" "$CLAUDE_DIR/.sudo-overrides-pending"

# 2. hook + rules + owner override script
cp "$HARNESS_DIR/hooks/command-guard.py" "$CLAUDE_DIR/hooks/command-guard.py"
if [ -e "$CLAUDE_DIR/safety-guard/security-rules.json" ]; then
  echo "  keep existing security-rules.json (not overwritten)"
else
  cp "$HARNESS_DIR/security-rules.json" "$CLAUDE_DIR/safety-guard/security-rules.json"
fi
[ -f "$HARNESS_DIR/bin/grant-override" ] && { cp "$HARNESS_DIR/bin/grant-override" "$CLAUDE_DIR/bin/"; chmod +x "$CLAUDE_DIR/bin/grant-override" 2>/dev/null || true; }

# 2b. model-router (auto model selection): copy the whole module
if command -v node >/dev/null 2>&1; then
  mkdir -p "$CLAUDE_DIR/model-router"
  cp "$HARNESS_DIR/model-router/router.mjs" "$HARNESS_DIR/model-router/pick.mjs" \
     "$HARNESS_DIR/model-router/model-advisor.mjs" "$HARNESS_DIR/model-router/routing-rules.json" \
     "$CLAUDE_DIR/model-router/"
  ADVISOR_ABS="$("$PYBIN" -c "import pathlib,os;print(pathlib.Path(os.path.expanduser('~/.claude/model-router/model-advisor.mjs')).as_posix())")"

  # 2c. skill-router: deploy + build the index over the INSTALLED skills, wire advisor
  mkdir -p "$CLAUDE_DIR/skill-router"
  cp "$HARNESS_DIR/skill-router/matcher.mjs" "$HARNESS_DIR/skill-router/build-index.mjs" \
     "$HARNESS_DIR/skill-router/skill-advisor.mjs" "$HARNESS_DIR/skill-router/synonyms.json" \
     "$CLAUDE_DIR/skill-router/"
  node "$CLAUDE_DIR/skill-router/build-index.mjs" "$CLAUDE_DIR/skills" "$CLAUDE_DIR/skill-router/skill-index.json" || echo "  (skill index build skipped)"
  SKILL_ADVISOR_ABS="$("$PYBIN" -c "import pathlib,os;print(pathlib.Path(os.path.expanduser('~/.claude/skill-router/skill-advisor.mjs')).as_posix())")"
else
  echo "  node not found — model-router + skill-router advisor hooks skipped (guard still armed)"
  ADVISOR_ABS=""
  SKILL_ADVISOR_ABS=""
fi

# 3. resolve an absolute, forward-slash hook path python can read on Windows
HOOK_ABS="$("$PYBIN" -c "import pathlib,os; print(pathlib.Path(os.path.expanduser('~/.claude/hooks/command-guard.py')).as_posix())")"

# 4. backup settings.json then merge PreToolUse hooks (JSON-aware, idempotent)
SETTINGS="$CLAUDE_DIR/settings.json"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
STAMP="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo bak)"
cp "$SETTINGS" "$SETTINGS.bak-$STAMP"
echo "  backup: settings.json.bak-$STAMP"

PYBIN="$PYBIN" HOOK_ABS="$HOOK_ABS" ADVISOR_ABS="$ADVISOR_ABS" SKILL_ADVISOR_ABS="${SKILL_ADVISOR_ABS:-}" SETTINGS="$SETTINGS" "$PYBIN" - <<'PYEOF'
import json, os
settings_path = os.environ["SETTINGS"]
hook_abs = os.environ["HOOK_ABS"]
advisor_abs = os.environ.get("ADVISOR_ABS", "")
skill_advisor_abs = os.environ.get("SKILL_ADVISOR_ABS", "")
pybin = os.environ["PYBIN"]
cmd = f'{pybin} "{hook_abs}"'
with open(settings_path, encoding="utf-8") as f:
    cfg = json.load(f)
hooks = cfg.setdefault("hooks", {})

# guard: PreToolUse
pre = hooks.setdefault("PreToolUse", [])
def has_pre(matcher):
    for e in pre:
        if e.get("matcher") == matcher:
            for h in e.get("hooks", []):
                if "command-guard.py" in h.get("command", ""):
                    return True
    return False
added = 0
for m in ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"]:
    if not has_pre(m):
        pre.append({"matcher": m, "hooks": [{"type": "command", "command": cmd}]})
        added += 1

# advisors: UserPromptSubmit (advisory — hooks cannot switch models or call tools)
ups = hooks.setdefault("UserPromptSubmit", [])
def wire_ups(abs_path, needle):
    if not abs_path:
        return 0
    present = any(needle in h.get("command", "") for e in ups for h in e.get("hooks", []))
    if present:
        return 0
    ups.append({"hooks": [{"type": "command", "command": f'node "{abs_path}"'}]})
    return 1
advisor_added = wire_ups(advisor_abs, "model-advisor.mjs")
skill_added = wire_ups(skill_advisor_abs, "skill-advisor.mjs")

with open(settings_path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
print(f"  merged {added} PreToolUse matcher(s) + {advisor_added} model-advisor + {skill_added} skill-advisor")
PYEOF

echo "✓ Harness armed:"
echo "  - Guard (PreToolUse): blocks irreversible ops on Bash/Write/Edit/MultiEdit/NotebookEdit."
echo "  - Model-router advisor (UserPromptSubmit): recommends /model per task."
echo "  - Skill-router advisor (UserPromptSubmit): auto-detects & surfaces relevant skills per task."
echo "  - Launcher: model-router/2aio-run.sh picks --model automatically at launch."
echo "  Re-run this after adding skills to refresh the skill index."
echo "  Owner bypass: prefix a command with '!'.   Disarm: bash $HARNESS_DIR/uninstall-harness.sh"
