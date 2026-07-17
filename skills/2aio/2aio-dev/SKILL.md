---
name: 2aio-dev
description: "2AIO 入口③「既存プロジェクトで機能実装・バグ修正」。動いているリポジトリに1機能足す/バグを直すを、取締役会・PRD・WBSなしで最短で回す。既存プロダクトへの機能追加やバグ修正を頼まれた、といった依頼で使う。"
---

Claude Code では `/2aio-dev` としても同一内容を直接呼べる（`~/.claude/commands/2aio-dev.md` に配備される）。
このファイルは同じ入口を、slash command を持たない host（Codex 等）からも明示・自動の両方で呼べるようにする薄い pointer。

`~/.claude/commands/2aio-dev.md` を Read し、その指示に $ARGUMENTS を
「<repoパス> <機能記述 | --fix バグ報告/Issue文> [--auto] [--pr]」として厳密に従って実行してください。

host 差分（並列 Task 起動が使えない・AskUserQuestion tool が無い等）は、対象リポジトリの `AGENTS.md`
（Codex なら通常 `~/.codex/AGENTS.md` にも配備される）の「Codex から 2AIO を起動する」節に従うこと。
