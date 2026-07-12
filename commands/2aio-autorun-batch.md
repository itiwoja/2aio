---
description: 複数テーマの 2AIO 全フェーズ（取締役会→計画→実装→デプロイ）を連続自律実行するバッチオーケストレーター
argument-hint: '--themes="..." | --themes-file=... | --resume={batch_id} [--board=lite|full] [--platform=...]'
disable-model-invocation: true
---

複数のテーマについて、2AIO の全フェーズ（取締役会 → 計画 → 実装 → デプロイ）を **一切止まらず** 連続実行してください。

**入力:** $ARGUMENTS

**出力先:** `output/` の正本は `C:/Users/1kkim/projects/2aio-output/` に固定（cwd に依存しない）

## 引数フォーマット

```
/2aio-autorun-batch
  --themes="テーマ1; テーマ2; テーマ3; ..."
  [--mode=auto]
  [--platform=vercel|firebase|gh-pages]
  [--board=lite|full]（既定: lite）
  [--resume={batch_id}]
```

または、テーマ一覧をファイルから読む:

```
/2aio-autorun-batch --themes-file=batch-themes.md
```

`batch-themes.md` の例:

```markdown
---
batch_id: 2026-05-23-batch-001
mode: auto
default_platform: vercel
---

# Batch Themes

1. LP制作会社向けポートフォリオサイト
2. 個人ブログ（Astro 静的サイト）
3. Todo アプリ MVP（Next.js）
4. 名刺代わりのプロフィールサイト
5. レシピメモアプリ（静的 SPA）
```

---

## 役割

このコマンドは **複数プロジェクトの一括自律実行** を担うバッチオーケストレーター。
内部で各テーマについて以下を順次実行する:

```
For each theme in themes:
  1. /2aio-start-project {theme} --lite    → board-meeting + PRD（prd_file を記録）
  2. /2aio-plan-project {prd_file}         → impl-plan（impl_plan_file を記録）
  3. /2aio-implement-project --auto {impl_plan_file} → 実装→QA→デプロイ
  4. メインスレッドが output/_memory/index.md に索引追記
  5. バッチ進捗を batch-state-{batch_id}.md に追記
```

## 絶対制約

1. **モードは auto がデフォルト。** 引数で interactive 指定された場合のみ interactive。
2. **1 つのテーマで失敗しても次のテーマへ進む。** 失敗は batch-state-{batch_id}.md に記録、停止しない（ただし連続2失敗ブレーカとロールバック失敗 [ROLLBACK_FAILED] を除く — エラー処理表参照）。
3. **絶対の安全線**（モード問わず維持）:
   - セキュリティゲート Step 2.5 のブロック条件（gitleaks leak>0 / SAST CRITICAL>0）による [SECURITY_STOP]
   - 対応外プラットフォーム
   - CEO 承認 = rejected（該当テーマの実装フェーズ進行を禁止する安全線。バッチ自体は次テーマへ続行する — B-1 参照）
   - state.md / batch-state-{batch_id}.md の I/O 障害
4. **コード生成は各エージェントに完全委譲。** 本コマンドは状態遷移のみ管理。

---

## 実行フロー

### Phase A-0: キックオフ承認（必須）

テーマ一覧・デプロイ先プラットフォーム・公開有無・想定生成物を提示し、ユーザーの明示的肯定（はい/OK/yes）を得てからバッチを開始する。この承認がバッチ内全テーマのデプロイ承認（各 state.md の `auto_approve: true`）を兼ねる。承認が得られなければ開始しない。

### Phase A: バッチ初期化

1. 引数からテーマ一覧とモードを抽出
2. `output/_batch/` ディレクトリを作成
3. `output/_batch/batch-state-{batch_id}.md` を以下の frontmatter で初期化（同パスが既存なら上書きせず `--resume={batch_id}` を案内して停止）:

```markdown
---
batch_id: {YYYY-MM-DD-batch-NNN}
mode: {auto | interactive}
default_platform: {vercel | firebase | gh-pages}
themes_total: {n}
themes_completed: 0
themes_succeeded: 0
themes_degraded: 0
themes_failed: 0
current_theme_index: 0
created_at: {ISO 8601}
updated_at: {ISO 8601}
tags: [2aio, batch, autorun]
---

# Batch State: {batch_id}

## バッチ進捗

| # | テーマ | プロジェクト略称 | ステータス | PRDパス | impl-planパス | 本番URL | 所要時間 |
|---|---|---|---|---|---|---|---|
| 1 | {theme1} | {project1} | pending | - | - | - | - |
| 2 | {theme2} | {project2} | pending | - | - | - | - |
| ... | ... | ... | ... | ... | ... | ... | ... |

## 次のアクション
- テーマ 1 の `/2aio-start-project` を実行

## タイムライン
| 時刻 | イベント |
|---|---|
| {ISO 8601} | バッチ初期化 ({n} テーマ) |
```

### Phase B: テーマループ

各テーマ i について以下を順次実行:

#### B-1: 取締役会フェーズ

```
/2aio-start-project {テーマi} --lite
```

- 既定は `--lite`。`--board=full` 指定時、または batch-themes.md の該当テーマに `board: full` がある場合のみフル取締役会
- 内部的に 2aio-start-project の Phase 1〜6 が走る（アーカイブは B-4 で本コマンドが実施）
- `output/board-meeting-{project_i}-{日付}.md` と `output/prd-{project_i}-{日付}.md` が生成される
- 完了時、生成された PRD の実パスを batch-state の該当テーマ行（新列 `prd_file`）に記録する。未生成ならテーマ i を `failed` として次テーマへ
- batch-state-{batch_id}.md タイムラインに記録

**安全停止判定:**
- CEO 判断が `rejected` または `needs_review` の場合: 該当ステータスで batch-state-{batch_id}.md に記録し **次テーマへ続行**（バッチ全体は止めない）

#### B-2: 計画フェーズ

CEO 判断が approved / conditional の場合のみ:

```
/2aio-plan-project {batch-state に記録した prd_file}
```

- `(latest)` 渡しは使用禁止（前テーマ成果物とのクロス汚染防止）
- `output/impl-plan-{project_i}-{日付}.md` が生成される
- 完了時、impl-plan の実パスを新列 `impl_plan_file` に記録する。未生成ならテーマ i を `failed` として次テーマへ
- batch-state-{batch_id}.md タイムラインに記録

#### B-3: 実装フェーズ（auto モード）

```
/2aio-implement-project --auto {batch-state に記録した impl_plan_file}
```

- `(latest)` 渡しは使用禁止
- 内部で `2aio-engineer` → `2aio-qa` → `2aio-devops` が auto モードで走る
- devops 起動前に該当テーマの state.md が `mode: auto` かつ `auto_approve: true`（Phase A-0 承認由来）であることを確認し、不足していれば Edit で補正する（無人実行で承認待ちに入らないため）
- デプロイ直前には 2aio-devops の Step 2.5 セキュリティゲート（gitleaks + SAST）が必ず実行される。ブロック条件（gitleaks leak>0 / SAST CRITICAL>0）の [SECURITY_STOP] 時はテーマ i を `failed` として次テーマへ
- 失敗は FAIL_FORWARD / DEGRADED で続行
- 本番 URL を取得して batch-state-{batch_id}.md に記録
- 安全停止（Step 2.5 ブロック・対応外プラットフォーム）が発動した場合のみ、テーマ i を `failed` として **次テーマへ続行**

#### B-4: アーカイブ

本コマンド（メインスレッド）が completion-report.md の要約1行（テーマ・ステータス・URL）を `output/_memory/index.md` に追記する（エージェントは起動しない）。

#### B-5: テーマ完了処理

batch-state-{batch_id}.md の該当行を更新:

| ステータス | 条件 |
|---|---|
| `success` | デプロイ成功、completion_status = success |
| `degraded` | デプロイ成功だが FAIL_FORWARD / DEGRADED あり |
| `failed` | デプロイ未到達 or 安全停止 |
| `rejected` | CEO 判断が rejected |
| `needs_review` | CEO 判断が needs_review（情報不足で判断保留） |
| `interrupted` | 中断時点でデプロイ未実施（deployed_url: null） |

`themes_completed++`、該当カウンタ（succeeded/degraded/failed）++、`current_theme_index++`。

### Phase C: バッチ完了レポート

全テーマ完了後、`output/_batch/batch-completion-{batch_id}.md` を生成:

```markdown
---
batch_id: {batch_id}
type: batch-completion
themes_total: {n}
themes_succeeded: {n}
themes_degraded: {n}
themes_failed: {n}
themes_rejected: {n}
themes_needs_review: {n}
completed_at: {ISO 8601}
total_duration_minutes: {分}
tags: [2aio, batch, completion]
---

# Batch Completion: {batch_id}

## サマリー

- 総テーマ数: {n}
- 成功: {n}
- degraded 完走: {n}
- 失敗: {n}
- CEO rejected: {n}
- 合計所要時間: {X 時間 Y 分}

## 各テーマ結果

| # | テーマ | ステータス | 本番URL | 完了タスク率 | レポート |
|---|---|---|---|---|---|
| 1 | {theme1} | success | https://... | 100% | [[completion-report]] |
| 2 | {theme2} | degraded | https://... | 85% (FAIL_FORWARD: 2) | [[completion-report]] |
| 3 | {theme3} | rejected | - | - | [[board-meeting]] |
| ... | ... | ... | ... | ... | ... |

## バッチ全体の知見

- 共通失敗パターン: {あれば集約}
- 推奨次アクション:
  - degraded テーマ → v2 計画化推奨
  - failed テーマ → 原因分析（多くは技術スタック選定 or 対応外プラットフォーム）
  - rejected テーマ → 市場再評価 or テーマ自体の見直し

## 関連ファイル

{各テーマの state.md / completion-report.md への wikilink 一覧}
```

---

## エラー処理（auto モード基準）

| 状況 | 動作 |
|---|---|
| テーマ i の CEO 判断が rejected | テーマ i を rejected 記録、次テーマへ |
| テーマ i の安全停止発動（秘密検出等） | テーマ i を failed 記録、次テーマへ |
| テーマ i の degraded 完走 | テーマ i を degraded 記録、次テーマへ |
| テーマ i のいずれかのフェーズが予期せず失敗（必須成果物の未生成を含む） | テーマ i を failed 記録、原因1行を記録し次テーマへ |
| 同種の原因で 2 テーマ連続 failed | 環境起因の可能性が高いためバッチ停止し、原因と再開コマンド（--resume）を提示 |
| テーマ i のロールバック失敗（[ROLLBACK_FAILED]） | テーマ i を failed 記録・ユーザーへ即時報告の上でバッチ停止（壊れた本番の放置防止） |
| バッチ自体の I/O 障害（batch-state-{batch_id}.md 書けない） | バッチ停止（致命） |
| ユーザーから中断指示 | 進行中のファイル書き込み・現在の1タスクのみ安全に完了させ、新規フェーズ（特に 2aio-devops デプロイ）には進まず batch-state に `interrupted` を記録して即停止（--resume で再開可） |

**1 つのテーマの失敗で全体を止めない** のが本コマンドの核。

---

## resume サポート

バッチが途中で切れた場合、以下で resume 可能:

```
/2aio-autorun-batch --resume={batch_id}
```

- `output/_batch/batch-state-{batch_id}.md` を読む（存在しなければエラーで停止）
- `current_theme_index` 以降のテーマから再開
- 完了済みテーマはスキップ
- **進行中テーマの再開判定表（#24 — board 会議・計画のやり直しによる二重消費を防ぐ）**:

| batch-state の該当テーマ行 | 再開位置 |
|---|---|
| `prd_file` 未記録 | B-1（取締役会）から |
| `prd_file` 有り ＋ `impl_plan_file` 無し | B-2（計画）から。PRD は再生成しない |
| `impl_plan_file` 有り ＋ `output/{project}/state.md` **不在** | B-3 を `/2aio-implement-project --auto {impl_plan_file}` で**新規**起動 |
| `output/{project}/state.md` **存在** | `/2aio-implement-project resume {project}` へ委譲 |

（implement の resume は state.md 不在時エラー仕様のため、後2者の分離が必須。
ステータスが `rejected` / `needs_review` / `failed` のテーマは再開せずスキップ。）

---

## 5 プロジェクト連続実行の標準呼び出し例

```
/2aio-autorun-batch
  --mode=auto
  --platform=vercel
  --themes="
    LP制作会社向けポートフォリオサイト;
    個人ブログ Astro 静的;
    Todoアプリ MVP Next.js;
    名刺プロフィールサイト;
    レシピメモ SPA
  "
```

期待される動作:
- 5 テーマすべてが順次自律実行される
- どこかで失敗しても次のテーマへ進む
- 最終的に batch-completion レポートで「5 件中 N 件成功、M 件 degraded、K 件 failed」を集計

---

## ガードレール再掲

- **モード問わず絶対の安全線は維持**（秘密検出・対応外プラットフォーム・CEO rejected・I/O 障害）
- **1 テーマ失敗で全体を止めない**
- **コード生成は各下位エージェントに完全委譲**
- **状態管理は batch-state-{batch_id}.md と 各 state.md の二層構造**
- **すべての更新は Edit で部分更新**
- **`default_platform: gh-pages` の場合、テーマごとに専用リポジトリを作成する**。作成不可ならそのテーマを failed とし、同一リポへの相乗りデプロイはしない

各テーマ完了ごとに batch-state-{batch_id}.md タイムラインへ進捗を追記しながら、ユーザーには簡潔に「テーマ {i}/{n} 完了 (ステータス)」と報告してください。
