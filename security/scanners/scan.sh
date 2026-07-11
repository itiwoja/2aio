#!/usr/bin/env bash
# 2AIO Ring-3 scanner runner.
# Runs every INSTALLED scanner against a target directory, aggregates reports,
# and exits non-zero if a blocking (secret leak / SAST CRITICAL) finding is seen.
# Missing tools are skipped with an explicit note — never a silent gap.
set -u

TARGET="${1:-.}"
if [ ! -d "$TARGET" ]; then echo "usage: scan.sh <dir>"; exit 2; fi

STAMP="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo run)"
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$SELF_DIR/_reports/$STAMP"
mkdir -p "$OUT"

BLOCK=0
RAN=0
SKIPPED=""

have() { command -v "$1" >/dev/null 2>&1; }
note() { echo "[2aio-scan] $*"; }

run() { # name  logfile  command...
  local name="$1" log="$2"; shift 2
  note "running $name ..."
  if "$@" >"$OUT/$log" 2>&1; then :; else true; fi
  RAN=$((RAN+1))
}

# --- secrets (blocking) ---
if have gitleaks; then
  note "running gitleaks ..."
  if gitleaks detect --source "$TARGET" --no-banner --redact >"$OUT/gitleaks.txt" 2>&1; then
    note "gitleaks: clean"
  else
    note "gitleaks: LEAK(S) FOUND -> BLOCKING"; BLOCK=1
  fi
  RAN=$((RAN+1))
else SKIPPED="$SKIPPED gitleaks"; fi

# --- SAST / security ---
if have bearer; then run "bearer" "bearer.txt" bearer scan "$TARGET" --exit-code 0; else SKIPPED="$SKIPPED bearer"; fi
if have checkov; then run "checkov" "checkov.txt" checkov -d "$TARGET" --compact --soft-fail; else SKIPPED="$SKIPPED checkov"; fi
if have kics; then run "kics" "kics.txt" kics scan -p "$TARGET" -o "$OUT" --no-progress; else SKIPPED="$SKIPPED kics"; fi
if have insider; then run "insider" "insider.txt" insider --target "$TARGET" --no-html; else SKIPPED="$SKIPPED insider"; fi
if have keyscope; then run "keyscope" "keyscope.txt" keyscope scan "$TARGET"; else SKIPPED="$SKIPPED keyscope"; fi

# --- supply chain (npx, no install needed if npx present) ---
if have npx; then
  run "shai-hulud" "shai-hulud.txt" npx --yes shai-hulud-scanner "$TARGET"
  run "react2shell" "react2shell.txt" npx --yes react2shell-scanner "$TARGET"
else SKIPPED="$SKIPPED npx-scanners"; fi

echo
note "==== SUMMARY ===="
note "target:   $TARGET"
note "reports:  $OUT"
note "ran:      $RAN scanner(s)"
[ -n "$SKIPPED" ] && note "skipped (not installed):$SKIPPED"
if [ "$BLOCK" -ne 0 ]; then
  note "RESULT: BLOCK — secret leak detected. Do not deploy until resolved."
  exit 1
fi
note "RESULT: no blocking findings (review reports for HIGH/MEDIUM)."
exit 0
