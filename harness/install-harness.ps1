#!/usr/bin/env pwsh
# 2AIO Live Harness installer (PowerShell). Arms the guardrail hook + supporting dirs.
# Idempotent, non-destructive: backs up settings.json, merges (never overwrites) hooks.
$ErrorActionPreference = "Stop"
$claudeDir = "$env:USERPROFILE/.claude"
$harnessDir = Split-Path $MyInvocation.MyCommand.Path
if (-not (Test-Path $claudeDir)) { Write-Host "Claude Code not found"; exit 1 }

$py = "python"
& $py -c "import sys" 2>$null
if (-not $?) { Write-Host "No working python"; exit 1 }

Write-Host "=== 2AIO Live Harness install ===" -ForegroundColor Cyan
foreach ($d in @("hooks", "safety-guard", "bin", ".sudo-overrides", ".sudo-overrides-pending")) {
    New-Item -ItemType Directory -Force "$claudeDir/$d" | Out-Null
}
Copy-Item "$harnessDir/hooks/command-guard.py" "$claudeDir/hooks/command-guard.py" -Force
if (-not (Test-Path "$claudeDir/safety-guard/security-rules.json")) {
    Copy-Item "$harnessDir/security-rules.json" "$claudeDir/safety-guard/security-rules.json" -Force
} else { Write-Host "  keep existing security-rules.json" }
if (Test-Path "$harnessDir/bin/grant-override") { Copy-Item "$harnessDir/bin/grant-override" "$claudeDir/bin/" -Force }

# delegation-enforcer (Claude=commander, Codex=implementer): PreToolUse/Write rule
Copy-Item "$harnessDir/enforce/delegation-enforcer.py" "$claudeDir/hooks/delegation-enforcer.py" -Force
New-Item -ItemType Directory -Force "$claudeDir/enforce" | Out-Null
if (-not (Test-Path "$claudeDir/enforce/enforce-rules.json")) {
    Copy-Item "$harnessDir/enforce/enforce-rules.json" "$claudeDir/enforce/enforce-rules.json" -Force
} else { Write-Host "  keep existing enforce-rules.json" }

$env:ENFORCER_ABS = (& $py -c "import pathlib,os;print(pathlib.Path(os.path.expanduser('~/.claude/hooks/delegation-enforcer.py')).as_posix())")
$env:ADVISOR_ABS = ""
$env:SKILL_ADVISOR_ABS = ""
$env:CODEX_ADVISOR_ABS = ""
$env:FRONTDOOR_ADVISOR_ABS = ""

# Router/advisor modules require node; the guard and enforcer do not.
if (Get-Command node -ErrorAction SilentlyContinue) {
    New-Item -ItemType Directory -Force "$claudeDir/model-router" | Out-Null
    foreach ($f in @("router.mjs", "pick.mjs", "model-advisor.mjs", "routing-rules.json")) {
        Copy-Item "$harnessDir/model-router/$f" "$claudeDir/model-router/$f" -Force
    }
    $env:ADVISOR_ABS = (& $py -c "import pathlib,os;print(pathlib.Path(os.path.expanduser('~/.claude/model-router/model-advisor.mjs')).as_posix())")

    New-Item -ItemType Directory -Force "$claudeDir/skill-router" | Out-Null
    foreach ($f in @("matcher.mjs", "build-index.mjs", "skill-advisor.mjs", "synonyms.json")) {
        Copy-Item "$harnessDir/skill-router/$f" "$claudeDir/skill-router/$f" -Force
    }
    & node "$claudeDir/skill-router/build-index.mjs" "$claudeDir/skills" "$claudeDir/skill-router/skill-index.json"
    if (-not $?) { Write-Host "  (skill index build skipped)" }
    $env:SKILL_ADVISOR_ABS = (& $py -c "import pathlib,os;print(pathlib.Path(os.path.expanduser('~/.claude/skill-router/skill-advisor.mjs')).as_posix())")

    New-Item -ItemType Directory -Force "$claudeDir/codex-router" | Out-Null
    foreach ($f in @("codex-router.mjs", "pick-codex.mjs", "codex-run.sh", "routing-rules.json", "delegate-intent.mjs", "codex-advisor.mjs", "delegate-rules.json")) {
        Copy-Item "$harnessDir/codex-router/$f" "$claudeDir/codex-router/$f" -Force
    }
    $env:CODEX_ADVISOR_ABS = (& $py -c "import pathlib,os;print(pathlib.Path(os.path.expanduser('~/.claude/codex-router/codex-advisor.mjs')).as_posix())")
    Write-Host "  codex-router deployed (auto-delegate advisor + default Terra; see /2aio-delegate)"

    New-Item -ItemType Directory -Force "$claudeDir/providers" | Out-Null
    foreach ($f in @("ai-run.sh", "providers.json")) {
        Copy-Item "$harnessDir/providers/$f" "$claudeDir/providers/$f" -Force
    }
    Write-Host "  providers deployed (ai-run.sh: consult any OpenAI-compatible AI)"

    New-Item -ItemType Directory -Force "$claudeDir/front-door" | Out-Null
    foreach ($f in @("router.mjs", "2aio-advisor.mjs", "routes.json")) {
        Copy-Item "$harnessDir/front-door/$f" "$claudeDir/front-door/$f" -Force
    }
    $env:FRONTDOOR_ADVISOR_ABS = (& $py -c "import pathlib,os;print(pathlib.Path(os.path.expanduser('~/.claude/front-door/2aio-advisor.mjs')).as_posix())")
    Write-Host "  front-door deployed (auto-route business/redesign/research)"
} else {
    Write-Host "  node not found - model-router + skill-router advisor hooks skipped (guard still armed)"
}

$settings = "$claudeDir/settings.json"
if (-not (Test-Path $settings)) {
    [System.IO.File]::WriteAllText($settings, "{}", (New-Object System.Text.UTF8Encoding($false)))
}
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $settings "$settings.bak-$stamp"
Write-Host "  backup: settings.json.bak-$stamp"

$env:SETTINGS = $settings
$env:HOOK_ABS = (& $py -c "import pathlib,os;print(pathlib.Path(os.path.expanduser('~/.claude/hooks/command-guard.py')).as_posix())")
$env:PYBIN = $py
& $py - @"
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

pre = hooks.setdefault("PreToolUse", [])
def has_pre(matcher):
    for entry in pre:
        if entry.get("matcher") == matcher:
            for hook in entry.get("hooks", []):
                if "command-guard.py" in hook.get("command", ""):
                    return True
    return False

added = 0
for matcher in ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit"]:
    if not has_pre(matcher):
        pre.append({"matcher": matcher, "hooks": [{"type": "command", "command": cmd}]})
        added += 1

def has_pre_needle(matcher, needle):
    for entry in pre:
        if entry.get("matcher") == matcher:
            for hook in entry.get("hooks", []):
                if needle in hook.get("command", ""):
                    return True
    return False

enforcer_added = 0
if enforcer_abs and not has_pre_needle("Write", "delegation-enforcer"):
    pre.append({"matcher": "Write", "hooks": [{"type": "command", "command": f'{pybin} "{enforcer_abs}"'}]})
    enforcer_added = 1

ups = hooks.setdefault("UserPromptSubmit", [])
def wire_ups(abs_path, needle):
    if not abs_path:
        return 0
    present = any(needle in hook.get("command", "") for entry in ups for hook in entry.get("hooks", []))
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
"@

Write-Host "✓ Harness armed:" -ForegroundColor Green
Write-Host "  - Guard (PreToolUse): blocks irreversible ops on Bash/Write/Edit/MultiEdit/NotebookEdit."
Write-Host "  - Delegation-enforcer (PreToolUse/Write): blocks Claude writing bulk new impl -> forces Codex delegation."
Write-Host "  - Model-router advisor (UserPromptSubmit): recommends /model per task."
Write-Host "  - Skill-router advisor (UserPromptSubmit): auto-detects & surfaces relevant skills per task."
Write-Host "  - Auto-delegate advisor (UserPromptSubmit): detects implementation tasks & directs Claude->Codex."
Write-Host "  - Front-door advisor (UserPromptSubmit): auto-routes business/redesign/research to the right 2AIO pipeline."
Write-Host "  - Launcher: model-router/2aio-run.sh picks --model automatically at launch."
Write-Host "  - Codex delegation: ~/.claude/codex-router/codex-run.sh (default Terra) — see /2aio-delegate."
Write-Host "  Re-run this after adding skills to refresh the skill index."

$codexDir = "$env:USERPROFILE/.codex"
$agentsSource = Join-Path (Split-Path $harnessDir -Parent) "AGENTS.md"
if ((Test-Path $codexDir) -and (Test-Path $agentsSource)) {
    Copy-Item $agentsSource "$codexDir/AGENTS.md" -Force
    Write-Host "  - Codex adapter: ~/.codex/AGENTS.md deployed (Codex sessions inherit the 2AIO operating model)."
}

Write-Host "  Owner bypass: prefix a command with '!'.   Disarm: pwsh $harnessDir/uninstall-harness.ps1"
