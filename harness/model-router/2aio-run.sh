#!/usr/bin/env bash
# 2aio-run — launch Claude Code with the model auto-picked from your task.
# This is the ONLY place a model switch is genuinely automatic (a wrapper that
# sets --model before claude starts; hooks cannot switch models).
#
#   2aio-run "refactor the whole auth system"      # -> claude --model opus  "..."
#   2aio-run "rename these files"                   # -> claude --model haiku "..."
#   2aio-run --why "design the architecture"        # print the pick + reason, don't launch
#   2aio-run -p "quick: list routes"                # headless; forwards -p to claude
#
# Honors $CLAUDE_BIN (default: claude) and $MODEL_ROUTER_BUDGET (0..1, optional).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

WHY=0
PASS=()
for a in "$@"; do
  if [ "$a" = "--why" ]; then WHY=1; else PASS+=("$a"); fi
done
[ "${#PASS[@]}" -gt 0 ] || { echo "usage: 2aio-run [--why] \"task\" [claude args...]"; exit 2; }

TASK="${PASS[*]}"
BUDGET_ARG=()
[ -n "${MODEL_ROUTER_BUDGET:-}" ] && BUDGET_ARG=(--budget="$MODEL_ROUTER_BUDGET")

INFO="$(node "$HERE/pick.mjs" --json "${BUDGET_ARG[@]}" "$TASK")"
MODEL="$(node "$HERE/pick.mjs" "${BUDGET_ARG[@]}" "$TASK")"

if [ "$WHY" -eq 1 ]; then
  echo "picked model: $MODEL"
  echo "$INFO"
  exit 0
fi

echo "[2aio-run] auto-selected model: $MODEL"
exec "$CLAUDE_BIN" --model "$MODEL" "${PASS[@]}"
