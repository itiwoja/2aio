#!/usr/bin/env pwsh
$update = $false
$adoptAll = $false
foreach ($arg in $args) {
    switch ($arg) {
        "--update" { $update = $true }
        "--adopt-all" { $adoptAll = $true }
        default {
            Write-Host "Usage: $($MyInvocation.MyCommand.Name) [--update] [--adopt-all]"
            exit 1
        }
    }
}

Write-Host "`n=== 2AIO Installation ===" -ForegroundColor Cyan
$claudeDir = if ($env:CLAUDE_DIR) { $env:CLAUDE_DIR } else { Join-Path $env:USERPROFILE '.claude' }
if (-not (Test-Path $claudeDir)) {
    Write-Host "Claude Code not found: $claudeDir"; exit 1
}
# Codex is optional: only mirror skills there if it's already installed.
$codexDir = if ($env:CODEX_DIR) { $env:CODEX_DIR } else { Join-Path $env:USERPROFILE '.codex' }
$repoDir = Split-Path $MyInvocation.MyCommand.Path
foreach ($sub in @("agents", "commands", "skills")) {
    New-Item -ItemType Directory -Force (Join-Path $claudeDir $sub) | Out-Null
}
$lanesDir = Join-Path $claudeDir '2aio/lanes'
New-Item -ItemType Directory -Force $lanesDir | Out-Null
$scriptsDir = Join-Path $claudeDir '2aio/scripts'
New-Item -ItemType Directory -Force $scriptsDir | Out-Null

$manifestPath = "$claudeDir/.2aio-manifest"
$manifestEntries = @{}
$manifestDirty = $false
if (Test-Path -LiteralPath $manifestPath) {
    Get-Content -LiteralPath $manifestPath | ForEach-Object {
        $name = $_.Trim().TrimStart([char]0xFEFF)
        if ($name) { $manifestEntries[$name] = $true }
    }
} elseif ($update -and -not $adoptAll) {
    Write-Host "manifest not found; only new skills will be installed. Use --adopt-all to register existing skills."
}

function Add-ManifestEntry($Name) {
    if (-not $manifestEntries.ContainsKey($Name)) {
        $manifestEntries[$Name] = $true
        $script:manifestDirty = $true
    }
}

# Retire only command files managed by 2AIO. A user note or any non-2aio file
# is intentionally preserved.
Get-ChildItem (Join-Path $claudeDir 'commands') -Filter '2aio-*.md' -File -ErrorAction SilentlyContinue | ForEach-Object {
    if (-not (Test-Path (Join-Path $repoDir "commands/$($_.Name)"))) {
        Remove-Item -LiteralPath $_.FullName -Force
        Write-Host "  removed retired command: $($_.Name)"
    }
}

# Retire only agents managed by 2AIO. User-defined agents are intentionally
# preserved, while a removed shipped agent must not survive an update.
Get-ChildItem (Join-Path $claudeDir 'agents') -Filter '2aio-*.md' -File -ErrorAction SilentlyContinue | ForEach-Object {
    if (-not (Test-Path (Join-Path $repoDir "agents/$($_.Name)"))) {
        Remove-Item -LiteralPath $_.FullName -Force
        Write-Host "  removed retired agent: $($_.Name)"
    }
}

Write-Host "Installing agents, commands and lanes..." -ForegroundColor Cyan
@("agents", "commands") | ForEach-Object {
    if (Test-Path "$repoDir/$_") {
        Copy-Item "$repoDir/$_/*.md" (Join-Path $claudeDir $_) -Force
    }
}
Get-ChildItem (Join-Path $repoDir 'lanes') -Filter '2aio-*.md' -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $lanesDir -Force
}
Get-ChildItem (Join-Path $repoDir 'scripts') -Filter '*.mjs' -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $scriptsDir -Force
}

$repoSkills = @()
$repoSkillNames = @{}
if (Test-Path "$repoDir/skills") {
    Get-ChildItem "$repoDir/skills" -Directory | ForEach-Object {
        Get-ChildItem $_.FullName -Directory | ForEach-Object {
            if (Test-Path "$($_.FullName)/SKILL.md") {
                $repoSkills += $_
                $repoSkillNames[$_.Name] = $true
            }
        }
    }
}

if ($adoptAll) {
    foreach ($skill in $repoSkills) {
        if (Test-Path "$claudeDir/skills/$($skill.Name)") {
            Add-ManifestEntry $skill.Name
        }
    }
}

foreach ($name in $manifestEntries.Keys) {
    if (-not $repoSkillNames.ContainsKey($name)) {
        Write-Host "warn: $name is in manifest but no longer shipped"
    }
}

Write-Host "Installing skills (flattened, ECC-safe: never overwrite existing)..." -ForegroundColor Cyan
$count = 0
$updated = 0
foreach ($skill in $repoSkills) {
    $dest = "$claudeDir/skills/$($skill.Name)"
    if (Test-Path $dest) {
        if ($update -and $manifestEntries.ContainsKey($skill.Name)) {
            Remove-Item -LiteralPath $dest -Recurse -Force
            Copy-Item -LiteralPath $skill.FullName -Destination $dest -Recurse -Force
            $updated++
        } else {
            Write-Host "  skip (exists): $($skill.Name)"
        }
    } else {
        Copy-Item -LiteralPath $skill.FullName -Destination $dest -Recurse -Force
        Add-ManifestEntry $skill.Name
        $count++
    }
}
Write-Host "  installed $count new skill(s)"
if ($update) { Write-Host "  updated $updated managed skill(s)" }

# Codex: same skills, second destination. SKILL.md is a cross-agent standard
# (identical format Codex/Claude/OpenClaw read), so no content changes are needed —
# only skip if Codex isn't installed on this machine. Shares the Claude manifest
# (skill names are host-agnostic) and never overwrites an unmanaged skill.
if ((Test-Path $codexDir) -and $repoSkills.Count -gt 0) {
    New-Item -ItemType Directory -Force (Join-Path $codexDir "skills") | Out-Null
    $codexCount = 0
    $codexUpdated = 0
    foreach ($skill in $repoSkills) {
        $dest = "$codexDir/skills/$($skill.Name)"
        if (Test-Path $dest) {
            if ($update -and $manifestEntries.ContainsKey($skill.Name)) {
                Remove-Item -LiteralPath $dest -Recurse -Force
                Copy-Item -LiteralPath $skill.FullName -Destination $dest -Recurse -Force
                $codexUpdated++
            }
            continue   # never overwrite an unmanaged skill (ECC-safe)
        }
        Copy-Item -LiteralPath $skill.FullName -Destination $dest -Recurse -Force
        $codexCount++
    }
    Write-Host "  codex: installed $codexCount new skill(s)"
    if ($update) { Write-Host "  codex: updated $codexUpdated managed skill(s)" }
}

if ($manifestDirty) {
    $manifestEntries.Keys | Sort-Object | Set-Content -LiteralPath $manifestPath -Encoding utf8
}

Write-Host "`n✓ 2AIO Installation Complete (agents + commands + lanes + skills)" -ForegroundColor Green
Write-Host "  Security / memory / observability are external tools — install per their README."
