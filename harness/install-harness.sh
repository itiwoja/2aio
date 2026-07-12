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

# 2a. delegation-enforcer (Claude=commander, Codex=implementer): a PreToolUse rule that
#     blocks Claude from writing a substantial NEW implementation file itself (must delegate).
cp "$HARNESS_DIR/enforce/delegation-enforcer.py" "$CLAUDE_DIR/hooks/delegation-enforcer.py"
mkdir -p "$CLAUDE_DIR/enforce"
if [ -e "$CLAUDE_DIR/enforce/enforce-rules.json" ]; then
  echo "  keep existing enforce-rules.json (not overwritten)"
else
  cp "$HARNESS_DIR/enforce/enforce-rules.json" "$CLAUDE_DIR/enforce/enforce-rules.json"
fi
ENFORCER_ABS="$("$PYBIN" -c "import pathlib,os; print(pathlib.Path(os.path.expanduser('~/.claude/hooks/delegation-enforcer.py')).as_posix())")"

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

  # 2d. codex-router (Claude→Codex delegation): copy module + make wrapper executable
  mkdir -p "$CLAUDE_DIR/codex-router"
  cp "$HARNESS_DIR/codex-router/codex-router.mjs" "$HARNESS_DIR/codex-router/pick-codex.mjs" \
     "$HARNESS_DIR/codex-router/codex-run.sh" "$HARNESS_DIR/codex-router/routing-rules.json" \
     "$HARNESS_DIR/codex-router/delegate-intent.mjs" "$HARNESS_DIR/codex-router/codex-advisor.mjs" \
     "$HARNESS_DIR/codex-router/delegate-rules.json" \
     "$CLAUDE_DIR/codex-router/"
  chmod +x "$CLAUDE_DIR/codex-router/codex-run.sh" 2>/dev/null || true
  CODEX_ADVISOR_ABS="$("$PYBIN" -c "import pathlib,os;print(pathlib.Path(os.path.expanduser('~/.claude/codex-router/codex-advisor.mjs')).as_posix())")"
  echo "  codex-router deployed (auto-delegate advisor + delegate impl to Codex Terra/Luna)"

  # 2d2. providers (provider-agnostic delegation/consult): any OpenAI-compatible AI
  mkdir -p "$CLAUDE_DIR/providers"
  cp "$HARNESS_DIR/providers/ai-run.sh" "$HARNESS_DIR/providers/providers.json" "$CLAUDE_DIR/providers/"
  chmod +x "$CLAUDE_DIR/providers/ai-run.sh" 2>/dev/null || true
  echo "  providers deployed (ai-run.sh: consult any OpenAI-compatible AI — openai/xai/deepseek/ollama...)"

  # 2e. front-door router: routes a plain prompt to the right 2AIO pipeline (board/redesign/research)
  mkdir -p "$CLAUDE_DIR/front-door"
  cp "$HARNESS_DIR/front-door/router.mjs" "$HARNESS_DIR/front-door/2aio-advisor.mjs" \
     "$HARNESS_DIR/front-door/routes.json" \
     "$CLAUDE_DIR/front-door/"
  FRONTDOOR_ADVISOR_ABS="$("$PYBIN" -c "import pathlib,os;print(pathlib.Path(os.path.expanduser('~/.claude/front-door/2aio-advisor.mjs')).as_posix())")"
  echo "  front-door deployed (auto-route business/redesign/research to the right 2AIO pipeline)"
else
  echo "  node not found — model-router + skill-router advisor hooks skipped (guard still armed)"
  ADVISOR_ABS=""
  SKILL_ADVISOR_ABS=""
  CODEX_ADVISOR_ABS=""
  FRONTDOOR_ADVISOR_ABS=""
fi

# 3. resolve an absolute, forward-slash hook path python can read on Windows
HOOK_ABS="$("$PYBIN" -c "import pathlib,os; print(pathlib.Path(os.path.expanduser('~/.claude/hooks/command-guard.py')).as_posix())")"

# 4. backup settings.json then merge PreToolUse hooks (JSON-aware, idempotent)
SETTINGS="$CLAUDE_DIR/settings.json"
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
STAMP="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo bak)"
cp "$SETTINGS" "$SETTINGS.bak-$STAMP"
echo "  backup: settings.json.bak-$STAMP"

PYBIN="$PYBIN" HOOK_ABS="$HOOK_ABS" ENFORCER_ABS="${ENFORCER_ABS:-}" ADVISOR_ABS="$ADVISOR_ABS" SKILL_ADVISOR_ABS="${SKILL_ADVISOR_ABS:-}" CODEX_ADVISOR_ABS="${CODEX_ADVISOR_ABS:-}" FRONTDOOR_ADVISOR_ABS="${FRONTDOOR_ADVISOR_ABS:-}" SETTINGS="$SETTINGS" "$PYBIN" - <<'PYEOF'
import json, os
settings_path = os.environ["SETTINGS"]
hook_abs = os.environ["HOOK_ABS"]
enforcer_abs = os.environ.get("ENFORCER_ABS", "")
advisor_abs = os.environ.get("ADVISOR_ABS", "")
skill_advisor_abs = os.environ.get("SKILL_ADVISOR_ABS", "")
codex_advisor_abs = os.environ.get("CODEX_ADVISOR_ABS", "")
frontdoor_advisor_abs = os.environ.get("FRONTDOOR_ADVISOR_ABS", "")
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

# delegation-enforcer: PreToolUse on Write only (block bulk new impl -> delegate to Codex)
def has_pre_needle(matcher, needle):
    for e in pre:
        if e.get("matcher") == matcher:
            for h in e.get("hooks", []):
                if needle in h.get("command", ""):
                    return True
    return False
enforcer_added = 0
if enforcer_abs and not has_pre_needle("Write", "delegation-enforcer"):
    pre.append({"matcher": "Write", "hooks": [{"type": "command", "command": f'{pybin} "{enforcer_abs}"'}]})
    enforcer_added = 1

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
codex_added = wire_ups(codex_advisor_abs, "codex-advisor.mjs")
frontdoor_added = wire_ups(frontdoor_advisor_abs, "front-door/2aio-advisor.mjs")

with open(settings_path, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
print(f"  merged {added} PreToolUse matcher(s) + {enforcer_added} delegation-enforcer + {advisor_added} model-advisor + {skill_added} skill-advisor + {codex_added} codex-advisor + {frontdoor_added} front-door")
PYEOF

echo "✓ Harness armed:"
echo "  - Guard (PreToolUse): blocks irreversible ops on Bash/Write/Edit/MultiEdit/NotebookEdit."
echo "  - Delegation-enforcer (PreToolUse/Write): blocks Claude writing bulk new impl → forces Codex delegation."
echo "  - Model-router advisor (UserPromptSubmit): recommends /model per task."
echo "  - Skill-router advisor (UserPromptSubmit): auto-detects & surfaces relevant skills per task."
echo "  - Auto-delegate advisor (UserPromptSubmit): detects implementation tasks & directs Claude→Codex."
echo "  - Front-door advisor (UserPromptSubmit): auto-routes business/redesign/research to the right 2AIO pipeline."
echo "  - Launcher: model-router/2aio-run.sh picks --model automatically at launch."
echo "  - Codex delegation: ~/.claude/codex-router/codex-run.sh (default Terra) — see /2aio-delegate."
echo "  Re-run this after adding skills to refresh the skill index."
# cross-host: deploy the portable operating model to Codex if present
if [ -d "$HOME/.codex" ] && [ -f "$HARNESS_DIR/../AGENTS.md" ]; then
  cp "$HARNESS_DIR/../AGENTS.md" "$HOME/.codex/AGENTS.md"
  echo "  - Codex adapter: ~/.codex/AGENTS.md deployed (Codex sessions inherit the 2AIO operating model)."
fi

echo "  Owner bypass: prefix a command with '!'.   Disarm: bash $HARNESS_DIR/uninstall-harness.sh"
