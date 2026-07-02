#!/usr/bin/env pwsh
Write-Host "`n=== CCC Installation ===" -ForegroundColor Cyan
$claudeDir = "$env:USERPROFILE/.claude"
if (-not (Test-Path $claudeDir)) { 
    Write-Host "Claude Code not found"; exit 1
}
Write-Host "Installing agents and commands..." -ForegroundColor Cyan
$repoDir = Split-Path $MyInvocation.MyCommand.Path
@("agents","commands") | ForEach-Object {
    if (Test-Path "$repoDir/$_") {
        Copy-Item "$repoDir/$_/*" "$claudeDir/$_/" -Force
    }
}
Write-Host "✓ Installation Complete" -ForegroundColor Green
