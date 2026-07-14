#!/bin/bash
set -e

usage() {
  echo "Usage: $0 [--update] [--adopt-all]"
}

UPDATE=0
ADOPT_ALL=0
for arg in "$@"; do
  case "$arg" in
    --update) UPDATE=1 ;;
    --adopt-all) ADOPT_ALL=1 ;;
    *) usage; exit 1 ;;
  esac
done

echo "=== 2AIO Installation ==="
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
# PowerShell may pass a Windows path into Git Bash through CLAUDE_DIR / CODEX_DIR.
if command -v cygpath >/dev/null 2>&1 && [[ "$CLAUDE_DIR" == *\\* ]]; then
  CLAUDE_DIR="$(cygpath -u "$CLAUDE_DIR")"
fi
[ -d "$CLAUDE_DIR" ] || { echo "Claude Code not found: $CLAUDE_DIR"; exit 1; }
# Codex is optional: only mirror skills there if ~/.codex already exists (Codex CLI/App installed).
CODEX_DIR="${CODEX_DIR:-$HOME/.codex}"
if command -v cygpath >/dev/null 2>&1 && [[ "$CODEX_DIR" == *\\* ]]; then
  CODEX_DIR="$(cygpath -u "$CODEX_DIR")"
fi
mkdir -p "$CLAUDE_DIR/agents" "$CLAUDE_DIR/commands" "$CLAUDE_DIR/skills" "$CLAUDE_DIR/2aio/lanes" "$CLAUDE_DIR/2aio/scripts"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$CLAUDE_DIR/.2aio-manifest"
MANIFEST_WORK="$(mktemp)"
REPO_SKILLS="$(mktemp)"
trap 'rm -f "$MANIFEST_WORK" "$REPO_SKILLS"' EXIT
MANIFEST_DIRTY=0

if [ -f "$MANIFEST" ]; then
  # Tolerate PowerShell's UTF-8 BOM and CRLF, plus blank or padded lines.
  tr -d '\r' < "$MANIFEST" | sed $'1s/^\xef\xbb\xbf//' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | awk 'NF' > "$MANIFEST_WORK"
elif [ "$UPDATE" -eq 1 ] && [ "$ADOPT_ALL" -eq 0 ]; then
  echo "manifest not found; only new skills will be installed. Use --adopt-all to register existing skills."
fi

manifest_contains() {
  grep -Fxq "$1" "$MANIFEST_WORK"
}

manifest_add() {
  if ! manifest_contains "$1"; then
    printf '%s\n' "$1" >> "$MANIFEST_WORK"
    MANIFEST_DIRTY=1
  fi
}

repo_contains() {
  grep -Fxq "$1" "$REPO_SKILLS"
}

# Retire only command files managed by 2AIO. A user note or any non-2aio file
# is intentionally preserved.
for installed in "$CLAUDE_DIR/commands"/2aio-*.md; do
  [ -e "$installed" ] || continue
  name="$(basename "$installed")"
  if [ ! -e "$SCRIPT_DIR/commands/$name" ]; then
    rm -f "$installed"
    echo "  removed retired command: $name"
  fi
done

# Retire only agents managed by 2AIO. User-defined agents are intentionally
# preserved, while a removed shipped agent must not survive an update.
for installed in "$CLAUDE_DIR/agents"/2aio-*.md; do
  [ -e "$installed" ] || continue
  name="$(basename "$installed")"
  if [ ! -e "$SCRIPT_DIR/agents/$name" ]; then
    rm -f "$installed"
    echo "  removed retired agent: $name"
  fi
done

# Agents + entry commands + internal lanes (always overwritten)
[ -d "$SCRIPT_DIR/agents" ] && cp "$SCRIPT_DIR/agents"/*.md "$CLAUDE_DIR/agents/"
[ -d "$SCRIPT_DIR/commands" ] && cp "$SCRIPT_DIR/commands"/*.md "$CLAUDE_DIR/commands/"
if [ -d "$SCRIPT_DIR/lanes" ]; then
  for source in "$SCRIPT_DIR/lanes"/2aio-*.md; do
    [ -e "$source" ] && cp "$source" "$CLAUDE_DIR/2aio/lanes/"
  done
fi
if [ -d "$SCRIPT_DIR/scripts" ]; then
  for source in "$SCRIPT_DIR/scripts"/*.mjs; do
    [ -e "$source" ] && cp "$source" "$CLAUDE_DIR/2aio/scripts/"
  done
fi

# Collect shipped skills once so adoption and manifest warnings use the same set.
if [ -d "$SCRIPT_DIR/skills" ]; then
  for d in "$SCRIPT_DIR/skills"/*/*/; do
    [ -f "$d/SKILL.md" ] || continue
    printf '%s\n' "$(basename "$d")" >> "$REPO_SKILLS"
  done
fi

# Register pre-manifest installs before deciding which skills are managed updates.
if [ "$ADOPT_ALL" -eq 1 ]; then
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    [ -e "$CLAUDE_DIR/skills/$name" ] && manifest_add "$name"
  done < "$REPO_SKILLS"
fi

while IFS= read -r name; do
  [ -n "$name" ] || continue
  repo_contains "$name" || echo "warn: $name is in manifest but no longer shipped"
done < "$MANIFEST_WORK"

# Skills — flatten category subdirs (skills/<cat>/<name>/ -> ~/.claude/skills/<name>/)
if [ -d "$SCRIPT_DIR/skills" ]; then
  count=0
  updated=0
  for d in "$SCRIPT_DIR/skills"/*/*/; do
    [ -f "$d/SKILL.md" ] || continue
    name="$(basename "$d")"
    dest="$CLAUDE_DIR/skills/$name"
    if [ -e "$dest" ]; then
      if [ "$UPDATE" -eq 1 ] && manifest_contains "$name"; then
        rm -rf "$dest"
        cp -r "$d" "$dest"
        updated=$((updated+1))
      else
        echo "  skip (exists): $name"   # never overwrite an unmanaged skill (ECC-safe)
      fi
      continue
    fi
    cp -r "$d" "$dest"
    manifest_add "$name"
    count=$((count+1))
  done
  echo "  installed $count new skill(s)"
  [ "$UPDATE" -eq 1 ] && echo "  updated $updated managed skill(s)"
fi

# Codex: same skills, second destination. SKILL.md is a cross-agent standard
# (identical format Codex/Claude/OpenClaw read), so no content changes are needed —
# only skip if Codex isn't installed on this machine. Shares the Claude manifest
# (skill names are host-agnostic) and never overwrites an unmanaged skill.
if [ -d "$CODEX_DIR" ] && [ -d "$SCRIPT_DIR/skills" ]; then
  mkdir -p "$CODEX_DIR/skills"
  codex_count=0
  codex_updated=0
  for d in "$SCRIPT_DIR/skills"/*/*/; do
    [ -f "$d/SKILL.md" ] || continue
    name="$(basename "$d")"
    dest="$CODEX_DIR/skills/$name"
    if [ -e "$dest" ]; then
      if [ "$UPDATE" -eq 1 ] && manifest_contains "$name"; then
        rm -rf "$dest"
        cp -r "$d" "$dest"
        codex_updated=$((codex_updated+1))
      fi
      continue   # never overwrite an unmanaged skill (ECC-safe)
    fi
    cp -r "$d" "$dest"
    codex_count=$((codex_count+1))
  done
  echo "  codex: installed $codex_count new skill(s)"
  [ "$UPDATE" -eq 1 ] && echo "  codex: updated $codex_updated managed skill(s)"
fi

if [ "$MANIFEST_DIRTY" -eq 1 ]; then
  sort -u "$MANIFEST_WORK" > "$MANIFEST_WORK.sorted"
  mv "$MANIFEST_WORK.sorted" "$MANIFEST"
fi

echo "✓ 2AIO Installation Complete (agents + commands + lanes + skills)"
echo "  Security / memory / observability are external tools — install per their README."
