#!/usr/bin/env bash
set -euo pipefail

echo "=== 2AIO Installation ==="
CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
# PowerShell may pass a Windows path into Git Bash through CLAUDE_DIR.
if command -v cygpath >/dev/null 2>&1 && [[ "$CLAUDE_DIR" == *\\* ]]; then
  CLAUDE_DIR="$(cygpath -u "$CLAUDE_DIR")"
fi
[ -d "$CLAUDE_DIR" ] || { echo "Claude Code not found: $CLAUDE_DIR"; exit 1; }
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$CLAUDE_DIR/agents" "$CLAUDE_DIR/commands" "$CLAUDE_DIR/skills" "$CLAUDE_DIR/2aio/lanes"

# Only managed 2aio command files are retired. User commands and every
# non-2aio file remain untouched.
for installed in "$CLAUDE_DIR/commands"/2aio-*.md; do
  [ -e "$installed" ] || continue
  name="$(basename "$installed")"
  if [ ! -e "$SCRIPT_DIR/commands/$name" ]; then
    rm -f "$installed"
    echo "  removed retired command: $name"
  fi
done

for source in "$SCRIPT_DIR/agents"/*.md; do [ -e "$source" ] && cp "$source" "$CLAUDE_DIR/agents/"; done
for source in "$SCRIPT_DIR/commands"/2aio-*.md; do [ -e "$source" ] && cp "$source" "$CLAUDE_DIR/commands/"; done
for source in "$SCRIPT_DIR/lanes"/2aio-*.md; do [ -e "$source" ] && cp "$source" "$CLAUDE_DIR/2aio/lanes/"; done

# Flatten category subdirectories and preserve an existing user-installed skill.
count=0
for skill in "$SCRIPT_DIR/skills"/*/*/; do
  [ -f "$skill/SKILL.md" ] || continue
  name="$(basename "$skill")"
  dest="$CLAUDE_DIR/skills/$name"
  if [ -e "$dest" ]; then
    echo "  skip (exists): $name"
    continue
  fi
  cp -R "$skill" "$dest"
  count=$((count + 1))
done

echo "  installed $count new skill(s)"
echo "2AIO installation complete (agents + commands + lanes + skills)"
