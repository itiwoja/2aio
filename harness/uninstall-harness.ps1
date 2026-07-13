#!/usr/bin/env pwsh
# 2AIO Live Harness uninstaller — removes 2AIO hooks from settings.json while
# retaining installed hook files and rules for fast re-arming.
$ErrorActionPreference = "Stop"
$claudeDir = "$env:USERPROFILE/.claude"
$settings = "$claudeDir/settings.json"
if (-not (Test-Path $settings)) { Write-Host "no settings.json"; exit 0 }

$py = "python"
& $py -c "import sys" 2>$null
if (-not $?) { Write-Host "No working python"; exit 1 }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$settings.bak-$stamp"
Copy-Item $settings $backup

$env:SETTINGS = $settings
# NOTE: pipe the here-string into `python -` via stdin. Passing it as an argument to
# `& $py - <here-string>` makes `python -` block on stdin (hang). Always pipe.
@"
import json, os
p = os.environ["SETTINGS"]
with open(p, encoding="utf-8") as f:
    cfg = json.load(f)
hooks = cfg.get("hooks", {})

def strip(event, needle):
    arr = hooks.get(event, [])
    kept = []
    for entry in arr:
        entry["hooks"] = [hook for hook in entry.get("hooks", []) if needle not in hook.get("command", "")]
        if entry["hooks"]:
            kept.append(entry)
    if kept:
        hooks[event] = kept
    else:
        hooks.pop(event, None)

strip("PreToolUse", "command-guard.py")
strip("PreToolUse", "delegation-enforcer")
strip("UserPromptSubmit", "model-advisor.mjs")
strip("UserPromptSubmit", "skill-advisor.mjs")
strip("UserPromptSubmit", "codex-advisor.mjs")
strip("UserPromptSubmit", "2aio-advisor.mjs")
if "hooks" in cfg and not hooks:
    cfg.pop("hooks")
with open(p, "w", encoding="utf-8") as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
print("  removed 2AIO guard, delegation-enforcer, and advisor hooks from settings.json")
"@ | & $py -

Write-Host "✓ Harness disarmed (backup: $backup). Hook files + rules kept for re-arming." -ForegroundColor Green
