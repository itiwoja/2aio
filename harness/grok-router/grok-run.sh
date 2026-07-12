#!/usr/bin/env bash
# 2AIO grok-run — thin, safe wrapper to consult Grok (xAI API) as a 2AIO provider.
# Grok's strength in the 2AIO routing table: real-time info, SNS sentiment, trend
# research. Returns text (the API does not write files); take its output and, if it's
# an implementation, review + integrate yourself or hand to a file-writing provider.
#
#   grok-run.sh "X上でのこのサービスの評判を要約して"
#   grok-run.sh --model grok-4-latest "..."      # override model
#   echo "long context" | grok-run.sh "上記を分析して"   # stdin appended to prompt
#
# Config (env; keys NEVER pass through argv or logs):
#   XAI_API_KEY   (or GROK_API_KEY)   — required. From env only, never in chat/brief.
#   GROK_MODEL    — default model id (verify the current id for your account).
#   XAI_API_URL   — default https://api.x.ai/v1/chat/completions
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USAGE_LOG="${AIO_USAGE_LOG:-$HOME/.claude/logs/2aio-usage.jsonl}"
API_URL="${XAI_API_URL:-https://api.x.ai/v1/chat/completions}"
MODEL="${GROK_MODEL:-grok-4-latest}"
KEY="${XAI_API_KEY:-${GROK_API_KEY:-}}"

MODEL_ARG=""; PROMPT_PARTS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="$2"; shift 2;;
    *) PROMPT_PARTS+=("$1"); shift;;
  esac
done
PROMPT="${PROMPT_PARTS[*]}"
# append stdin if piped (long context)
if [ ! -t 0 ]; then STDIN="$(cat)"; [ -n "$STDIN" ] && PROMPT="$PROMPT

$STDIN"; fi
[ -n "$PROMPT" ] || { echo "usage: grok-run.sh [--model <id>] \"prompt\""; exit 2; }

if [ -z "$KEY" ]; then
  echo "[grok-run] REFUSING: no XAI_API_KEY / GROK_API_KEY in env. Set it (env only, never in chat)." >&2
  exit 3
fi

ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
mkdir -p "$(dirname "$USAGE_LOG")" 2>/dev/null || true
# audit log (no secrets): who/when/what provider+model, task truncated by node
node -e '
  const a=process.argv;
  const o={ts:a[1],tool:"2aio-grok-run",event:"grok_consult",provider:"grok",model:a[2],
           task:[...a[3]].slice(0,280).join("")};
  process.stdout.write(JSON.stringify(o)+"\n");
' "$ISO" "$MODEL" "$PROMPT" >> "$USAGE_LOG" 2>/dev/null || true

# build request body safely with node (proper JSON escaping of the prompt)
BODY="$(node -e '
  const [model, prompt]=process.argv.slice(1);
  process.stdout.write(JSON.stringify({model, messages:[{role:"user",content:prompt}], stream:false}));
' "$MODEL" "$PROMPT")"

echo "[grok-run] provider=grok model=$MODEL  (audit=$USAGE_LOG)" >&2
# key passed via header only; --data from a var. 10MB cap on response.
RESP="$(curl -sS --max-time 120 "$API_URL" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  --data "$BODY" | head -c 10485760)"

# extract the text; on parse failure, print raw for debugging (never the key)
node -e '
  let d=""; process.stdin.on("data",c=>d+=c); process.stdin.on("end",()=>{
    try { const j=JSON.parse(d); const t=j.choices?.[0]?.message?.content;
      process.stdout.write(t ?? JSON.stringify(j)); }
    catch { process.stdout.write(d); }
  });
' <<< "$RESP"
echo ""
