#!/usr/bin/env bash
# 2AIO codex-run — safe wrapper around `codex exec` for delegated implementation.
# Defaults to Terra/Luna (never Sol unless the task is explicitly hard) so delegation
# saves tokens. Applies every known codex-exec safety rule.
#
#   codex-run.sh "scaffold the api tests"                 # auto model (luna), read-only
#   codex-run.sh --write "implement the login component"  # workspace-write, auto model (terra)
#   codex-run.sh --write --bg -C /path/to/repo "task"     # background, in that repo
#   codex-run.sh --model sol --write "hard concurrency fix"
#   codex-run.sh --why "one-line task"                    # print picked model only
#
# Options:
#   --model auto|luna|terra|sol|<full-id>   (default auto)
#   --write            workspace-write sandbox (default: read-only)
#   -C <dir>           project directory
#   -o <file>          structured jsonl result (default: .ai/codex_result_<ts>.jsonl)
#   --effort <level>   none|minimal|low|medium|high|xhigh
#   --bg               run in background (codex exec is slow; recommended for real work)
#   --why              just print the chosen model and exit
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX_BIN="${CODEX_BIN:-codex}"

MODEL="auto"; SANDBOX="read-only"; DIR="."; OUT=""; EFFORT=""; BG=0; WHY=0
PROMPT_PARTS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="$2"; shift 2;;
    --write) SANDBOX="workspace-write"; shift;;
    -C) DIR="$2"; shift 2;;
    -o) OUT="$2"; shift 2;;
    --effort) EFFORT="$2"; shift 2;;
    --bg) BG=1; shift;;
    --why) WHY=1; shift;;
    *) PROMPT_PARTS+=("$1"); shift;;
  esac
done
PROMPT="${PROMPT_PARTS[*]}"
[ -n "$PROMPT" ] || { echo "usage: codex-run.sh [opts] \"task\""; exit 2; }

# resolve model
case "$MODEL" in
  auto) MODEL_ID="$(node "$HERE/pick-codex.mjs" "$PROMPT")";;
  luna) MODEL_ID="gpt-5.6-luna";;
  terra) MODEL_ID="gpt-5.6-terra";;
  sol) MODEL_ID="gpt-5.6-sol";;
  *) MODEL_ID="$MODEL";;
esac

if [ "$WHY" -eq 1 ]; then echo "$MODEL_ID"; exit 0; fi

TS="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo run)"
[ -n "$OUT" ] || { mkdir -p "$DIR/.ai"; OUT="$DIR/.ai/codex_result_$TS.jsonl"; }
LOG="$DIR/.ai/codex_log_$TS.txt"; mkdir -p "$(dirname "$LOG")"

EFFORT_ARG=()
[ -n "$EFFORT" ] && EFFORT_ARG=(-c "model_reasoning_effort=\"$EFFORT\"")

run() {
  # stdin closed (< /dev/null) — codex-cli hangs otherwise. Log capped at 10 MB.
  "$CODEX_BIN" exec --sandbox "$SANDBOX" -m "$MODEL_ID" "${EFFORT_ARG[@]}" \
    --skip-git-repo-check -C "$DIR" -o "$OUT" \
    "$PROMPT" < /dev/null 2>&1 | head -c 10485760 > "$LOG"
}

echo "[codex-run] model=$MODEL_ID sandbox=$SANDBOX dir=$DIR"
echo "[codex-run] result=$OUT  log=$LOG"
if [ "$BG" -eq 1 ]; then
  run & echo "[codex-run] started in background (pid $!). Collect result from: $OUT"
else
  run
  echo "[codex-run] done. Result: $OUT"
fi
