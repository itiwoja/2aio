#!/usr/bin/env python
"""2AIO delegation-enforcer — PreToolUse hook (Write).

Enforces the 2AIO operating model: **Claude is the commander (plans, reviews,
integrates); Codex does the bulk implementation typing.** This hook BLOCKS the
one action that violates it — Claude writing a substantial NEW implementation
file itself — and tells it to delegate that file to Codex instead.

Deliberately narrow so Claude keeps its commander role:
  - Only the Write tool is gated (Edit/MultiEdit on existing files stay free —
    that IS review/integration/fix work).
  - Only large CODE files count (>= min_lines, code extension).
  - Planning docs (.md/.ai/.coord), config/data, small files, tests, and the
    2AIO repo itself are always allowed.

Exit 0 = allow, Exit 2 = block. Fail-open: any error/None allows through.
Owner bypass: prefix the action with ! . Disable: enabled=false or the flag file.
"""
import json
import os
import sys
from pathlib import Path

RULES_PATH = Path(os.environ.get(
    "CLAUDE_ENFORCE_RULES",
    Path.home() / ".claude" / "enforce" / "enforce-rules.json",
))


def load_rules():
    try:
        with open(RULES_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None  # missing/broken -> fail-open (enforcement off)


def norm(p: str) -> str:
    return (p or "").replace("\\", "/").lower()


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if data.get("tool_name") != "Write":
        sys.exit(0)

    rules = load_rules()
    if not rules or not rules.get("enabled", False):
        sys.exit(0)

    # Quick-disable flag file (owner can `touch` it; AI-writable, not protected).
    flag = os.path.expanduser(rules.get("disable_flag", "~/.claude/.2aio-enforce-off"))
    if flag and Path(flag).exists():
        sys.exit(0)

    tool_input = data.get("tool_input", {})
    file_path = tool_input.get("file_path", "")
    content = tool_input.get("content", "")
    if not file_path:
        sys.exit(0)

    np = norm(file_path)

    # Allowed locations (scratchpad, .claude, .ai/.coord, node_modules, the 2AIO repo, ...)
    for sub in rules.get("allow_path_substrings", []):
        if norm(sub) in np:
            sys.exit(0)

    # Allowed by filename (tests, type decls, ...)
    base = os.path.basename(np)
    for sub in rules.get("allow_name_substrings", []):
        if norm(sub) in base:
            sys.exit(0)

    # Only gate real code files.
    exts = [e.lower() for e in rules.get("code_exts", [])]
    if not any(np.endswith(e) for e in exts):
        sys.exit(0)

    # Only gate SUBSTANTIAL files — small/critical snippets stay with the commander.
    lines = content.count("\n") + 1 if content else 0
    if lines < int(rules.get("min_lines", 40)):
        sys.exit(0)

    # Block: this is bulk new implementation — delegate it to Codex.
    print(
        f"BLOCKED (2AIO): writing a substantial new implementation file yourself "
        f"({os.path.basename(file_path)}, {lines} lines). Per the 2AIO operating model "
        f"you are the COMMANDER — keep the plan/review, delegate the coding to Codex:\n"
        f"  1) finalize your plan (acceptance criteria + files) in .ai/codex_brief_*.md\n"
        f"  2) run: bash ~/.claude/codex-router/codex-run.sh --write -C <dir> \"<task>\"\n"
        f"  3) review Codex's output (git diff) and integrate via Edit.\n"
        f"Edits to existing files, docs, config, and small files are NOT blocked. "
        f"To write it yourself anyway: owner via ! , or set enforce enabled=false / "
        f"touch ~/.claude/.2aio-enforce-off .",
        file=sys.stderr,
    )
    sys.exit(2)


if __name__ == "__main__":
    main()
