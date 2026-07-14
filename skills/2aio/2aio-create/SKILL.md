---
name: 2aio-create
description: "2AIO 入口①「一から作る」。アイデア 1 行から規模を自動判定し、最適な内部レーン（高速 build / 取締役会→計画→実装のフルコース）で完走する。新規プロダクト・アプリ・ツール・LP・プロトタイプを作りたい、といった依頼で使う。"
---

Claude Code では `/2aio-create` としても同一内容を直接呼べる（`~/.claude/commands/2aio-create.md` に配備される）。
このファイルは同じ入口を、slash command を持たない host（Codex 等）からも明示・自動の両方で呼べるようにする薄い pointer。

`~/.claude/commands/2aio-create.md` を Read し、その指示に $ARGUMENTS を「<ユーザーが作りたいもの> [--quick|--full] [--auto]」
として厳密に従って実行してください。

host 差分（並列 Task 起動が使えない・AskUserQuestion tool が無い等）は、対象リポジトリの `AGENTS.md`
（Codex なら通常 `~/.codex/AGENTS.md` にも配備される）の「Codex から 2AIO を起動する」節に従うこと。
