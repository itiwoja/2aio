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
DIR_ABS="$(cd "$DIR" 2>/dev/null && pwd || echo "$DIR")"

# High-quality delegation needs a written plan (acceptance criteria + edge cases).
BRIEF_PRESENT=0
if ls "$DIR"/.ai/codex_brief_*.md >/dev/null 2>&1; then BRIEF_PRESENT=1; fi

# JSON line built by node (guaranteed available) — correct UTF-8, no multibyte
# truncation corruption, proper escaping. task truncated by CODE POINTS not bytes.
log_event() { # $1=event  $2=optional extra json fragment, e.g. '"exit":0'
  node -e '
    const a = process.argv;
    const o = { ts:a[1], tool:"2aio-codex-run", event:a[2], model:a[3], tier:a[4],
                sandbox:a[5], dir:a[6], task:[...a[7]].slice(0,280).join(""),
                result:a[8], log:a[9], brief_present: a[10]==="1" };
    if (a[11]) { try { Object.assign(o, JSON.parse("{"+a[11]+"}")); } catch {} }
    process.stdout.write(JSON.stringify(o)+"\n");
  ' "$ISO" "$1" "$MODEL_ID" "$TIER" "$SANDBOX" "$DIR_ABS" "$PROMPT" "$OUT" "$LOG" "$BRIEF_PRESENT" "${2:-}" \
    >> "$USAGE_LOG" 2>/dev/null || true
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

# A high-quality delegation is planned first: a brief with measurable acceptance
# criteria + edge cases. Warn (or refuse) when it is missing.
if [ "$BRIEF_PRESENT" -eq 0 ]; then
  echo "[codex-run] WARNING: no .ai/codex_brief_*.md in $DIR — delegate WITH a written plan"
  echo "[codex-run]          (measurable acceptance criteria + edge cases). Ideally produced by a"
  echo "[codex-run]          2aio-planner sub-agent. Set AIO_REQUIRE_BRIEF=1 to enforce."
  if [ "${AIO_REQUIRE_BRIEF:-0}" = "1" ]; then
    echo "[codex-run] REFUSING (AIO_REQUIRE_BRIEF=1): write .ai/codex_brief_*.md first."; exit 3
  fi
fi

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
