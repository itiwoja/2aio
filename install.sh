#!/bin/bash
set -e
echo "=== 2AIO Installation ==="
CLAUDE_DIR="$HOME/.claude"
[ -d "$CLAUDE_DIR" ] || { echo "Claude Code not found"; exit 1; }
mkdir -p "$CLAUDE_DIR/agents" "$CLAUDE_DIR/commands" "$CLAUDE_DIR/skills"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Agents + commands (2aio-*)
[ -d "$SCRIPT_DIR/agents" ] && cp "$SCRIPT_DIR/agents"/*.md "$CLAUDE_DIR/agents/"
[ -d "$SCRIPT_DIR/commands" ] && cp "$SCRIPT_DIR/commands"/*.md "$CLAUDE_DIR/commands/"

# Skills — flatten category subdirs (skills/<cat>/<name>/ -> ~/.claude/skills/<name>/)
if [ -d "$SCRIPT_DIR/skills" ]; then
  count=0
  for d in "$SCRIPT_DIR/skills"/*/*/; do
    [ -f "$d/SKILL.md" ] || continue
    name="$(basename "$d")"
    dest="$CLAUDE_DIR/skills/$name"
    if [ -e "$dest" ]; then
      echo "  skip (exists): $name"   # never overwrite an existing skill (ECC-safe)
      continue
    fi
    cp -r "$d" "$dest"
    count=$((count+1))
  done
  echo "  installed $count new skill(s)"
fi

echo "✓ 2AIO Installation Complete (agents + commands + skills)"
echo "  Security / memory / observability are external tools — install per their README."
