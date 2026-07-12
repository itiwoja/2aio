#!/usr/bin/env pwsh
# 2aio-run (PowerShell) — launch Claude Code with the model auto-picked from your task.
#   ./2aio-run.ps1 "refactor the whole auth system"
#   ./2aio-run.ps1 -Why "design the architecture"
param(
  [switch]$Why,
  [Parameter(ValueFromRemainingArguments = $true)] [string[]]$Rest
)
$here = Split-Path $MyInvocation.MyCommand.Path
$claudeBin = if ($env:CLAUDE_BIN) { $env:CLAUDE_BIN } else { "claude" }
if (-not $Rest -or $Rest.Count -eq 0) { Write-Host "usage: 2aio-run.ps1 [-Why] 'task' [claude args...]"; exit 2 }

$task = $Rest -join " "
$budget = @()
if ($env:MODEL_ROUTER_BUDGET) { $budget = @("--budget=$($env:MODEL_ROUTER_BUDGET)") }

$model = (& node "$here/pick.mjs" @budget $task).Trim()
if ($Why) {
  $info = (& node "$here/pick.mjs" "--json" @budget $task)
  Write-Host "picked model: $model"
  Write-Host $info
  exit 0
}
Write-Host "[2aio-run] auto-selected model: $model"
& $claudeBin "--model" $model @Rest
