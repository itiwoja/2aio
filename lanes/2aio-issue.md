---
description: Issue駆動入口レーン。GitHub Issue URL/番号を入力に、内容を読んで種別を決定的に分類し、既存レーン（/2aio-build・/2aio-implement-project・/2aio-dev）へルーティングする。
argument-hint: <GitHub Issue URL | Issue番号> [--auto]
---

> **表記の読み替え:** 本文中の `/2aio-<name>` は旧スラッシュコマンド表記。`~/.claude/2aio/lanes/2aio-<name>.md` を Read し、後続テキストを $ARGUMENTS としてその指示に従う意味に読み替える。

Issue から始まる作業の**対話側の入口**。決定的マッピング規約を使い、LLM の推測で repo / レーンを選ばない。

**対象:** $ARGUMENTS

## 入力の解決

| 入力形式 | 取得方法 |
|---|---|
| GitHub Issue URL / `#N` | `gh issue view {N} --json title,body,labels --comments` |

取得できなければその旨を報告して停止する（推測で進めない）。

## 分類規約（決定的）

1. **repo**: ラベル `repo:<slug>`（repos.json の id と一致）。無ければ**現在の cwd が対象 repo か**をユーザーに確認。
2. **kind**: ラベル `kind:build|start|plan|implement|analyze` があればそれに従う。
3. kind ラベルが無い場合のみ、本文から次の**表引き**でレーンを決める（新しい kind は作らない）:

| Issue の内容 | ルーティング先 |
|---|---|
| バグ報告（再現手順・エラーログがある） | `/2aio-dev . --fix "{要約}"` |
| 既存 repo への機能追加（1機能） | `/2aio-dev . "{要約}"` |
| 新規プロダクト・大きなテーマ | `/2aio-build "{要約}"`（急ぎ）または `/2aio-start-project "{要約}"`（取締役会） |
| 実装計画済み（impl-plan あり） | `/2aio-implement-project latest` |
| 調査・解析のみ | analyze 相当（repo を読んで報告） |

表のどれにも当てはまらない場合は分類候補を提示してユーザーに選ばせる（推測実行しない）。

## 実行

1. Issue 内容を 1 行に要約し、決定したルーティングを提示。
2. `--auto` 指定時はそのまま該当レーンを実行。未指定時はユーザーの確認を待ってから実行。
3. レーン完了後、完了確認（completion-report.md / state.md の `phase: completed`）が
   取れた場合のみ `gh issue close {N} --comment "{要約}"` で Issue を閉じる。
   確認できなければ「実行完了・要確認」コメントに留める。失敗時は失敗コメントを残して open のまま。

## 絶対制約

- repo / kind のマッピングに LLM 推測を使わない（上の決定的規約のみ。曖昧なら聞く）。
- `gh` が未認証の状態で Issue 側のコメント・クローズを試みない（報告のみで終える）。
