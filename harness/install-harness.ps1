#!/usr/bin/env pwsh
# 2AIO Live Harness installer (PowerShell). Arms the guardrail PreToolUse hook.
# Idempotent, non-destructive: backs up settings.json, merges (never overwrites) hooks.
$ErrorActionPreference = "Stop"
$claudeDir = "$env:USERPROFILE/.claude"
$harnessDir = Split-Path $MyInvocation.MyCommand.Path
if (-not (Test-Path $claudeDir)) { Write-Host "Claude Code not found"; exit 1 }

$py = "python"
& $py -c "import sys" 2>$null; if (-not $?) { Write-Host "No working python"; exit 1 }

Write-Host "=== 2AIO Live Harness install ===" -ForegroundColor Cyan
foreach ($d in @("hooks","safety-guard","bin",".sudo-overrides",".sudo-overrides-pending")) {
    New-Item -ItemType Directory -Force "$claudeDir/$d" | Out-Null
}
Copy-Item "$harnessDir/hooks/command-guard.py" "$claudeDir/hooks/command-guard.py" -Force
if (-not (Test-Path "$claudeDir/safety-guard/security-rules.json")) {
    Copy-Item "$harnessDir/security-rules.json" "$claudeDir/safety-guard/security-rules.json" -Force
} else { Write-Host "  keep existing security-rules.json" }
if (Test-Path "$harnessDir/bin/grant-override") { Copy-Item "$harnessDir/bin/grant-override" "$claudeDir/bin/" -Force }

$settings = "$claudeDir/settings.json"
if (-not (Test-Path $settings)) { "{}" | Out-File $settings -Encoding utf8 }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $settings "$settings.bak-$stamp"
Write-Host "  backup: settings.json.bak-$stamp"

$env:SETTINGS = $settings
$env:HOOK_ABS = (& $py -c "import pathlib,os;print(pathlib.Path(os.path.expanduser('~/.claude/hooks/command-guard.py')).as_posix())")
$env:PYBIN = $py
& $py - @"
import json, os
p=os.environ['SETTINGS']; cmd=f"{os.environ['PYBIN']} \"{os.environ['HOOK_ABS']}\""
cfg=json.load(open(p,encoding='utf-8'))
pre=cfg.setdefault('hooks',{}).setdefault('PreToolUse',[])
def has(m):
    return any(e.get('matcher')==m and any('command-guard.py' in h.get('command','') for h in e.get('hooks',[])) for e in pre)
added=0
for m in ['Bash','Write','Edit','MultiEdit','NotebookEdit']:
    if not has(m):
        pre.append({'matcher':m,'hooks':[{'type':'command','command':cmd}]}); added+=1
json.dump(cfg,open(p,'w',encoding='utf-8'),indent=2,ensure_ascii=False)
print(f'  merged {added} matcher(s)')
"@
Write-Host "`n✓ Harness armed. Disarm: bash uninstall-harness.sh" -ForegroundColor Green
