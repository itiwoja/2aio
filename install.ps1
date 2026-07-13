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
$claudeDir = if ($env:CLAUDE_DIR) { $env:CLAUDE_DIR } else { "$env:USERPROFILE/.claude" }
if (-not (Test-Path $claudeDir)) {
    Write-Host "Claude Code not found"; exit 1
}
$repoDir = Split-Path $MyInvocation.MyCommand.Path
foreach ($sub in @("agents", "commands", "skills")) {
    New-Item -ItemType Directory -Force "$claudeDir/$sub" | Out-Null
}

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

Write-Host "Installing agents and commands..." -ForegroundColor Cyan
@("agents", "commands") | ForEach-Object {
    if (Test-Path "$repoDir/$_") {
        Copy-Item "$repoDir/$_/*.md" "$claudeDir/$_/" -Force
    }
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

Write-Host "Installing skills (flattened, ECC-safe: never overwrite existing)" -ForegroundColor Cyan
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

if ($manifestDirty) {
    $manifestEntries.Keys | Sort-Object | Set-Content -LiteralPath $manifestPath -Encoding utf8
}

Write-Host "`n✓ 2AIO Installation Complete (agents + commands + skills)" -ForegroundColor Green
Write-Host "  Security / memory / observability are external tools — install per their README."
