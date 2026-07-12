#!/usr/bin/env bash
# 2AIO ai-run — provider-agnostic wrapper to consult ANY OpenAI-compatible AI as a
# 2AIO delegation/consult target. Provider-neutral: OpenAI, xAI(Grok), DeepSeek,
# Groq, local Ollama, ... are just rows in providers.json. Returns text.
#
#   ai-run.sh --provider openai "この設計をレビューして"
#   ai-run.sh --provider xai --model grok-4-latest "X上の評判を要約して"
#   ai-run.sh --provider ollama "ローカルで要約"          # no key needed
#   echo "long context" | ai-run.sh --provider deepseek "上記を分析"
#
# Config: providers.json (url/model/key_env per provider). Keys from env ONLY —
# never argv/chat/logs. Missing required key -> refuse (exit 3). Audit-logged.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REG="${AI_PROVIDERS:-$HERE/providers.json}"
USAGE_LOG="${AIO_USAGE_LOG:-$HOME/.claude/logs/2aio-usage.jsonl}"

PROVIDER=""; MODEL=""; PROMPT_PARTS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --provider) PROVIDER="$2"; shift 2;;
    --model) MODEL="$2"; shift 2;;
    *) PROMPT_PARTS+=("$1"); shift;;
  esac
done
[ -n "$PROVIDER" ] || PROVIDER="$(node -e 'process.stdout.write(require(process.argv[1]).default||"openai")' "$REG")"
PROMPT="${PROMPT_PARTS[*]}"
if [ ! -t 0 ]; then STDIN="$(cat)"; [ -n "$STDIN" ] && PROMPT="$PROMPT

$STDIN"; fi
[ -n "$PROMPT" ] || { echo "usage: ai-run.sh --provider <name> [--model <id>] \"prompt\""; exit 2; }

# resolve provider row (url / model / key_env) from the registry (tab-delimited)
ROW="$(node -e '
  const reg=require(process.argv[1]); const p=reg.providers[process.argv[2]];
  if(!p) process.exit(9);
  process.stdout.write([p.url, p.model, p.key_env||"-"].join("\t"));
' "$REG" "$PROVIDER" 2>/dev/null)" || true
[ -n "$ROW" ] || { echo "[ai-run] unknown provider '$PROVIDER' (see providers.json)" >&2; exit 2; }
IFS=$'\t' read -r URL DEF_MODEL KEY_ENV <<< "$ROW"
[ -n "$MODEL" ] || MODEL="$DEF_MODEL"

# key from env only (never argv/logs). key_env "-" means none required (e.g. ollama).
KEY=""
if [ "$KEY_ENV" != "-" ]; then
  KEY="$(printenv "$KEY_ENV" 2>/dev/null || true)"
  if [ -z "$KEY" ]; then
    echo "[ai-run] REFUSING: provider '$PROVIDER' needs \$$KEY_ENV in env (env only, never in chat)." >&2
    exit 3
  fi
fi

ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
mkdir -p "$(dirname "$USAGE_LOG")" 2>/dev/null || true
node -e '
  const a=process.argv;
  const o={ts:a[1],tool:"2aio-ai-run",event:"ai_consult",provider:a[2],model:a[3],
           task:[...a[4]].slice(0,280).join("")};
  process.stdout.write(JSON.stringify(o)+"\n");
' "$ISO" "$PROVIDER" "$MODEL" "$PROMPT" >> "$USAGE_LOG" 2>/dev/null || true

BODY="$(node -e '
  const [model,prompt]=process.argv.slice(1);
  process.stdout.write(JSON.stringify({model,messages:[{role:"user",content:prompt}],stream:false}));
' "$MODEL" "$PROMPT")"

echo "[ai-run] provider=$PROVIDER model=$MODEL  (audit=$USAGE_LOG)" >&2
AUTH=(); [ -n "$KEY" ] && AUTH=(-H "Authorization: Bearer $KEY")
RESP="$(curl -sS --max-time 120 "$URL" "${AUTH[@]}" -H "Content-Type: application/json" --data "$BODY" | head -c 10485760)"

node -e '
  let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
    try{const j=JSON.parse(d);const t=j.choices?.[0]?.message?.content;process.stdout.write(t??JSON.stringify(j));}
    catch{process.stdout.write(d);}
  });
' <<< "$RESP"
echo ""
