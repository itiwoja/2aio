#!/bin/bash
set -e
echo "=== CCC Installation ==="
CLAUDE_DIR="$HOME/.claude"
[ -d "$CLAUDE_DIR" ] || { echo "Claude Code not found"; exit 1; }
mkdir -p "$CLAUDE_DIR/agents" "$CLAUDE_DIR/commands"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -d "$SCRIPT_DIR/agents" ] && cp "$SCRIPT_DIR/agents"/*.md "$CLAUDE_DIR/agents/"
[ -d "$SCRIPT_DIR/commands" ] && cp "$SCRIPT_DIR/commands"/*.md "$CLAUDE_DIR/commands/"
echo "✓ Installation Complete"
