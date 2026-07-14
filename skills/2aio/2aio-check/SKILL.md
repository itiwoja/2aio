---
name: 2aio-check
description: "2AIO 入口②「既存プロジェクトの評価」。多観点で監査してスコア付きレポートと優先度付き改善案を出し、承認を得てから修正まで実行する。既存リポジトリの品質・セキュリティ・デザインを点検したい、といった依頼で使う。"
---

Claude Code では `/2aio-check` としても同一内容を直接呼べる（`~/.claude/commands/2aio-check.md` に配備される）。
このファイルは同じ入口を、slash command を持たない host（Codex 等）からも明示・自動の両方で呼べるようにする薄い pointer。

`~/.claude/commands/2aio-check.md` を Read し、その指示に $ARGUMENTS を「[path] [--report-only] [--dimensions=...]」
として厳密に従って実行してください。

host 差分（並列 Task 起動が使えない・AskUserQuestion tool が無い等）は、対象リポジトリの `AGENTS.md`
（Codex なら通常 `~/.codex/AGENTS.md` にも配備される）の「Codex から 2AIO を起動する」節に従うこと。
