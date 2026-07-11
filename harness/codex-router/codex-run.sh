#!/usr/bin/env bash
# 2AIO codex-run — safe wrapper around `codex exec` for delegated implementation.
# Defaults to Terra/Luna (never Sol unless the task is explicitly hard) so delegation
# saves tokens. Applies every known codex-exec safety rule, and records every
# delegation to a central audit log so you can PROVE 2AIO/Claude->Codex was used.
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
#
# Central audit log (append-only JSONL, one line per event):
#   $AIO_USAGE_LOG  (default: ~/.claude/logs/2aio-usage.jsonl)
#   A "codex_delegate_start" line is written BEFORE codex launches, so even if the
#   process is killed the proof that Claude->Codex was invoked survives.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX_BIN="${CODEX_BIN:-codex}"
USAGE_LOG="${AIO_USAGE_LOG:-$HOME/.claude/logs/2aio-usage.jsonl}"

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

# resolve model + tier (tier is used for the audit log)
case "$MODEL" in
  auto)
    PICK="$(node "$HERE/pick-codex.mjs" --json "$PROMPT")"
    MODEL_ID="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).model)" "$PICK")"
    TIER="$(node -e "process.stdout.write(JSON.parse(process.argv[1]).tier)" "$PICK")"
    ;;
  luna) MODEL_ID="gpt-5.6-luna"; TIER="luna";;
  terra) MODEL_ID="gpt-5.6-terra"; TIER="terra";;
  sol) MODEL_ID="gpt-5.6-sol"; TIER="sol";;
  *) MODEL_ID="$MODEL"; TIER="explicit";;
esac

if [ "$WHY" -eq 1 ]; then echo "$MODEL_ID"; exit 0; fi

TS="$(date -u +%Y%m%dT%H%M%SZ 2>/dev/null || echo run)"
ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
[ -n "$OUT" ] || { mkdir -p "$DIR/.ai"; OUT="$DIR/.ai/codex_result_$TS.jsonl"; }
LOG="$DIR/.ai/codex_log_$TS.txt"; mkdir -p "$(dirname "$LOG")"

# --- central audit log helpers -------------------------------------------------
mkdir -p "$(dirname "$USAGE_LOG")" 2>/dev/null || true
# JSON-escape: drop newlines/tabs, escape backslash and double-quote.
esc() { printf '%s' "$1" | tr '\n\r\t' '   ' | sed 's/\\/\\\\/g; s/"/\\"/g'; }
DIR_ABS="$(cd "$DIR" 2>/dev/null && pwd || echo "$DIR")"
log_event() { # $1=event  $2=extra-json (may be empty)
  local extra="${2:-}"
  { printf '{"ts":"%s","tool":"2aio-codex-run","event":"%s","model":"%s","tier":"%s","sandbox":"%s","dir":"%s","task":"%s","result":"%s","log":"%s"%s}\n' \
      "$ISO" "$1" "$MODEL_ID" "$TIER" "$SANDBOX" "$(esc "$DIR_ABS")" "$(esc "${PROMPT:0:280}")" "$(esc "$OUT")" "$(esc "$LOG")" \
      "${extra:+,$extra}" >> "$USAGE_LOG"; } 2>/dev/null || true
}

EFFORT_ARG=()
[ -n "$EFFORT" ] && EFFORT_ARG=(-c "model_reasoning_effort=\"$EFFORT\"")

CODEX_EXIT=""
run() {
  # stdin closed (< /dev/null) — codex-cli hangs otherwise. Log capped at 10 MB.
  "$CODEX_BIN" exec --sandbox "$SANDBOX" -m "$MODEL_ID" "${EFFORT_ARG[@]}" \
    --skip-git-repo-check -C "$DIR" -o "$OUT" \
    "$PROMPT" < /dev/null 2>&1 | head -c 10485760 > "$LOG"
  CODEX_EXIT="${PIPESTATUS[0]}"
}

echo "[codex-run] model=$MODEL_ID (tier=$TIER) sandbox=$SANDBOX dir=$DIR"
echo "[codex-run] result=$OUT  log=$LOG"
echo "[codex-run] audit=$USAGE_LOG"

# Proof-of-delegation is written BEFORE codex runs — survives a kill.
log_event "codex_delegate_start"

if [ "$BG" -eq 1 ]; then
  { run; log_event "codex_delegate_end" "\"exit\":${CODEX_EXIT:-null}"; } &
  echo "[codex-run] started in background (pid $!). Collect result from: $OUT"
else
  run
  log_event "codex_delegate_end" "\"exit\":${CODEX_EXIT:-null}"
  echo "[codex-run] done (exit ${CODEX_EXIT:-?}). Result: $OUT"
fi
