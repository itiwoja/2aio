#!/usr/bin/env pwsh
Write-Host "`n=== 2AIO Installation ===" -ForegroundColor Cyan
$claudeDir = "$env:USERPROFILE/.claude"
if (-not (Test-Path $claudeDir)) {
    Write-Host "Claude Code not found"; exit 1
}
$repoDir = Split-Path $MyInvocation.MyCommand.Path
foreach ($sub in @("agents","commands","skills")) {
    New-Item -ItemType Directory -Force "$claudeDir/$sub" | Out-Null
}

Write-Host "Installing agents and commands..." -ForegroundColor Cyan
@("agents","commands") | ForEach-Object {
    if (Test-Path "$repoDir/$_") {
        Copy-Item "$repoDir/$_/*.md" "$claudeDir/$_/" -Force
    }
}

Write-Host "Installing skills (flattened, ECC-safe: never overwrite existing)..." -ForegroundColor Cyan
$count = 0
if (Test-Path "$repoDir/skills") {
    Get-ChildItem "$repoDir/skills" -Directory | ForEach-Object {
        Get-ChildItem $_.FullName -Directory | ForEach-Object {
            $skill = $_
            if (Test-Path "$($skill.FullName)/SKILL.md") {
                $dest = "$claudeDir/skills/$($skill.Name)"
                if (Test-Path $dest) {
                    Write-Host "  skip (exists): $($skill.Name)"
                } else {
                    Copy-Item $skill.FullName $dest -Recurse -Force
                    $count++
                }
            }
        }
    }
}
Write-Host "  installed $count new skill(s)"
Write-Host "`n✓ 2AIO Installation Complete (agents + commands + skills)" -ForegroundColor Green
Write-Host "  Security / memory / observability are external tools — install per their README."
