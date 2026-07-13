#!/usr/bin/env pwsh
Write-Host "`n=== 2AIO Installation ===" -ForegroundColor Cyan
$claudeDir = if ($env:CLAUDE_DIR) { $env:CLAUDE_DIR } else { Join-Path $env:USERPROFILE '.claude' }
if (-not (Test-Path $claudeDir)) {
    Write-Host "Claude Code not found: $claudeDir"
    exit 1
}
$repoDir = Split-Path $MyInvocation.MyCommand.Path
@('agents', 'commands', 'skills') | ForEach-Object {
    New-Item -ItemType Directory -Force (Join-Path $claudeDir $_) | Out-Null
}
$lanesDir = Join-Path $claudeDir '2aio/lanes'
New-Item -ItemType Directory -Force $lanesDir | Out-Null

# Retire only command files managed by 2AIO. A user note or any non-2aio file
# is intentionally preserved.
Get-ChildItem (Join-Path $claudeDir 'commands') -Filter '2aio-*.md' -File -ErrorAction SilentlyContinue | ForEach-Object {
    if (-not (Test-Path (Join-Path $repoDir "commands/$($_.Name)"))) {
        Remove-Item -LiteralPath $_.FullName -Force
        Write-Host "  removed retired command: $($_.Name)"
    }
}

Get-ChildItem (Join-Path $repoDir 'agents') -Filter '*.md' -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $claudeDir 'agents') -Force
}
Get-ChildItem (Join-Path $repoDir 'commands') -Filter '2aio-*.md' -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $claudeDir 'commands') -Force
}
Get-ChildItem (Join-Path $repoDir 'lanes') -Filter '2aio-*.md' -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $lanesDir -Force
}

Write-Host "Installing skills (flattened; existing skills are preserved)..." -ForegroundColor Cyan
$count = 0
Get-ChildItem (Join-Path $repoDir 'skills') -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    Get-ChildItem $_.FullName -Directory | ForEach-Object {
        if (-not (Test-Path (Join-Path $_.FullName 'SKILL.md'))) { return }
        $dest = Join-Path (Join-Path $claudeDir 'skills') $_.Name
        if (Test-Path $dest) { Write-Host "  skip (exists): $($_.Name)" }
        else { Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force; $count++ }
    }
}
Write-Host "  installed $count new skill(s)"
Write-Host "2AIO installation complete (agents + commands + lanes + skills)" -ForegroundColor Green
