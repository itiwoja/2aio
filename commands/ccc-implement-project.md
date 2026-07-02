---
description: 実装計画書(impl-plan)を入力に ccc-engineer→ccc-qa→ccc-devops を Sprint 単位で自律実行し本番URLまで通す
argument-hint: "<impl-planパス|latest|resume {project}> [--auto|--interactive]"
---

以下の実装計画書を **自律実行エンジン** として実装→QA→デプロイまで通してください。

**入力 実装計画ファイル:** $ARGUMENTS

> 注記: `output/` の正本は `C:/Users/1kkim/projects/ccc-output/` に固定（cwd 依存禁止）。本ファイル中の `output/` はすべてこのパスを指す。

## 引数の解釈

引数の解析ルール:

| パターン | 意味 |
|---|---|
| `{path}.md` | 指定の実装計画ファイルを使用 |
| `latest` または空 | `output/` 内で最新の `impl-plan-*.md` を自動検出 |
| `resume {project}` | 既存の `output/{project}/state.md` から続きを再開 |
| `--auto` フラグを含む | auto モードで起動（計画承認等の安全停止バイパス・fail-forward 有効。デプロイ承認は下記 auto_approve 参照） |
| `--interactive` フラグを含む | interactive モード（デフォルト動作・全安全停止有効） |
| 引数末尾に `--mode=auto` 等 | 上記と同様、明示的モード指定 |

`--auto` は `mode: auto` を設定する。`auto_approve: true` は、起動時にユーザーへ「auto モードはデプロイ承認をバイパスします。よろしいですか?」と 1 回確認して肯定を得た場合のみ設定する（/ccc-autorun-batch 経由の場合は Phase A-0 キックオフ承認で代替し true）。それ以外は false。

実装計画ファイルが見つからない場合、`/ccc-plan-project {PRDパス}` を先に実行するよう案内して停止。

---

## 役割と絶対制約

CCC の最終ステージ。`impl-plan-*.md` を入力として、`ccc-engineer` → `ccc-qa` → `ccc-devops` を Sprint 単位で順次起動し、本番 URL を返すまでをワンコマンドで完走させる **自律実行オーケストレーター**。

```
Phase 0: /ccc-start-project       … 調査・意思決定 → PRD 生成
Phase 1: /ccc-plan-project        … PRD → 実装計画書
Phase 2: /ccc-implement-project   … 実装計画 → 自律実装 → 本番URL
```

### 絶対制約（モード問わず維持）

1. **本コマンド自身はコードを書かない。** 実装は `ccc-engineer`。
2. **計画書 WBS にないタスクは追加しない。**
3. **状態管理は `output/{project}/state.md` を正本とする。** ファイルが切れたらここから resume。
4. **第1プロジェクト想定:** Vercel デプロイ可能な静的サイト / Next.js / SPA。モバイル等は v2 以降で stopper。
5. **絶対の安全線（auto モードでも譲らない）:**
   - セキュリティゲート Step 2.5 のブロック条件（gitleaks leak>0 / SAST CRITICAL>0）による [SECURITY_STOP]
   - 対応外プラットフォーム検出
   - CEO 承認ステータスが `rejected`
   - impl-plan-*.md / state.md の I/O 障害

---

## モード仕様

### interactive モード（デフォルト）

- すべての安全停止が有効
- 以下の場合にユーザー判断待ちで停止:
  - Phase 1 計画読み込み後の承認確認
  - ccc-engineer の `[ESCALATION]`（3 回自己修正失敗）
  - ccc-qa の `[STUCK]`（2 往復目 Fail）
  - Sprint 内 50% 以上タスク Fail
  - ccc-devops のデプロイ前承認
  - スモークテスト Fail 時のロールバック判断

### auto モード（自律実行）

- 上記安全停止は **絶対の安全線以外すべてバイパス**
- 失敗は fail-forward で進む:
  - ccc-engineer 3 回失敗 → `[FAIL_FORWARD]` 記録 + 次タスク
  - ccc-qa 2 往復目 Fail → `[DEGRADED]` Sprint として次へ
  - Sprint 50% Fail → `[SPRINT_DEGRADED]` 記録 + 次へ
  - ccc-devops 承認 → state.md の `auto_approve: true` で自動デプロイ
  - スモーク Fail → 自動ロールバック + degraded 完了
- 完了レポートで「degraded 完走」として集計し、次回 plan-project への v2 提案を出す

---

## 実行フロー

### Phase 0: モード判定と state.md 初期化

#### 0-a. resume 指定の判定

引数が `resume {project}` の場合:

1. `output/{project}/state.md` が存在するか確認
2. 存在しなければエラー（resume 不可）
3. 存在すれば state.md を読み込み、`phase` と `## 次のアクション` を確認
4. そのアクションから処理を再開（Phase 1 はスキップ）

#### 0-b. 新規プロジェクトの初期化

入力 impl-plan-*.md からテーマ略称を抽出（例: `formai`, `lp-portfolio`）。
project = impl-plan ファイル名から `impl-plan-` プレフィックスと末尾の日付（正規表現 `-\d{4}-\d{2}-\d{2}$`）を除去した文字列。
`auto_approve` は「引数の解釈」の決定規則に従って設定する（明示オプトインが無ければ false）。
`output/{project}/` ディレクトリを作成（なければ）。

`output/{project}/state.md` を以下の frontmatter で **新規作成**:

```markdown
---
project: {テーマ略称}
phase: planning
mode: {auto | interactive}
auto_approve: {true | false}
deploy_approved: false
current_sprint: 0
current_task: null
sprints_total: {計画書から取得}
tasks_total: {計画書から取得}
tasks_completed: 0
tasks_failed: 0
tasks_scope_deferred: 0
qa_round: 0
escalations: 0
created_at: {ISO 8601}
updated_at: {ISO 8601}
plan_file: {impl-plan-*.md パス}
prd_file: {prd-*.md パス または unknown}
deployed_url: null
tags: [ccc, {project}, planning]
---

# State: [[{project}]]

## 現在地
- Phase: **planning**
- モード: {mode}

## 次のアクション
- Phase 1 計画読み込みを実行

## Sprint 進捗
（Phase 1 で計画書から生成）

## エスカレーション・退避項目
（なし）

## 関連ファイル
- 実装計画: [[{plan_file basename}]]

## タイムライン
| 時刻 | フェーズ | イベント |
|---|---|---|
| {ISO 8601} | planning | state.md 初期化 |
```

### Phase 1: 計画読み込み

1. impl-plan-*.md を読む
2. 以下を state.md に反映:
   - CEO 承認ステータス確認（rejected なら **モード問わず停止**）
   - 推奨技術スタック
   - Sprint 数とタスク総数
   - デプロイ先プラットフォーム
3. 対応プラットフォーム確認（Vercel/Firebase/GH Pages 以外なら **モード問わず停止**）
4. ハードコード秘密情報の予備スキャン（計画書内）
   ※実装コードの本スキャンは Phase 3 デプロイ前に ccc-devops が gitleaks で実施する（Step 2.5）

tasks_total / sprints_total はフェーズ=MVP のタスクのみで集計する（Phase2 タスクは Sprint ループの対象外）。計画書にスプリント計画が無い場合は sprints_total: 1 とし、全タスクを Sprint 1 として扱う。

#### モード別の Phase 1 完了動作

| モード | 動作 |
|---|---|
| `interactive` | ユーザーに「この計画で進めて良いか」確認 → 承認後 Phase 2 |
| `auto` | 確認なしで Phase 2 へ続行、state.md タイムラインに記録 |

state.md 更新:
- `phase: implementing`
- `current_sprint: 1`
- `## 次のアクション: ccc-engineer Sprint 1 起動`

### Phase 2: Sprint ループ

各 Sprint について繰り返し:

#### Phase 2-a: ccc-engineer 起動

```
入力:
  - output/{project}/state.md
  - impl-plan-*.md（該当 Sprint のタスク群）
  - CTO 技術評価セクション
出力:
  - output/{project}/build-log.md（追記）
  - state.md（current_task / tasks_completed / tasks_failed 更新）
```

起動前に state.md を `phase: implementing` に戻す。

ccc-engineer は state.md の `mode` を読んで動作分岐:
- interactive: 3 回失敗で停止
- auto: 3 回失敗で FAIL_FORWARD → 次タスク

#### Phase 2-b: ccc-qa 起動（1 往復目）

```
入力:
  - state.md
  - build-log.md
  - impl-plan-*.md（受け入れ条件正本）
  - 実装済みコード
出力:
  - output/{project}/qa-report-sprint{n}.md
  - state.md（`phase: qa` / qa_round 更新）
```

#### Phase 2-c: QA 結果分岐

| 結果 | interactive | auto |
|---|---|---|
| Pass | 次 Sprint or Phase 3 へ | 次 Sprint or Phase 3 へ |
| Fail (1往復目) | Phase 2-d へ | Phase 2-d へ |
| Stuck (2往復目 Fail) | 停止 | DEGRADED 記録 + 次 Sprint |
| Sprint 50% Fail | 停止 | SPRINT_DEGRADED 記録 + 次 Sprint |

#### Phase 2-d: ccc-engineer 修正（2 往復目）

qa-report-sprint{n}.md の修正指示を入力に再起動。完了後 ccc-qa を再度起動して 2 往復目検証。
修正対象は qa-report の修正指示に列挙されたタスクのみ。[FAIL_FORWARD] / [SKIPPED_DEP] タスクは再実装しない。

#### Phase 2-e: Sprint 完了判定

- 全 Sprint 完了 → Phase 3 へ
- 残 Sprint あり → Phase 2-a に戻る（次 Sprint）
  - 次 Sprint へ進む前に state.md の `qa_round: 0` へ Edit でリセットし、タイムラインに記録する
  - state.md を `phase: implementing` に戻す

### Phase 3: ccc-devops によるデプロイ

state.md の `phase: deploying` に遷移。

interactive モード、または `mode: auto` かつ `auto_approve` が true 以外の場合、ccc-devops 起動前に本コマンド（メインスレッド）がデプロイ計画（プラットフォーム・コマンド・想定URL）をユーザーに提示して明示的承認を取得し、state.md に `deploy_approved: true` と `deploy_approved_at: {ISO 8601}` を Edit で記録してから ccc-devops を起動する。未承認なら起動しない。

```
入力:
  - state.md（モード判定）
  - qa-report-sprint{n}.md（全 Sprint 分）
  - CTO 評価セクション
  - 実装済みコード
出力:
  - output/{project}/deploy-report.md
  - state.md（deployed_url / phase: completed 更新）
```

ccc-devops は state.md の `mode` と `auto_approve` を読んで動作分岐:
- interactive: `deploy_approved: true` を確認して実行（記録が無ければ「承認待ち」で return）
- auto + auto_approve: true: 即実行

安全停止（モード問わず）:
- ハードコード秘密検出
- ローカルビルド失敗
- 対応外プラットフォーム

### Phase 4: 完了レポート生成

`output/{project}/completion-report.md` を Obsidian 互換 frontmatter 付きで生成:

```markdown
---
project: {テーマ略称}
type: completion-report
phase: completed
mode: {mode}
completion_status: {success | degraded | failed}
deployed_url: {URL | null}
completed_at: {ISO 8601}
tags: [ccc, {project}, completion]
---

# 完了レポート: [[{project}]]

## サマリー

| 項目 | 値 |
|---|---|
| 完了ステータス | {success / degraded / failed} |
| 本番 URL | {URL} |
| モード | {mode} |
| Sprint 数 | {n} |
| 完了タスク | {n}/{tasks_total} ({XX%}) |
| FAIL_FORWARD | {n} 件 |
| DEGRADED Sprint | {n} 件 |
| SCOPE_DEFERRED | {n} 件 |
| SKIPPED_DEP | {n} 件 |
| 総所要時間 | {X 時間 Y 分} |

## ステータス判定ロジック

- `success`: 全タスク Pass、デプロイ成功、スモークテスト Pass
- `degraded`: FAIL_FORWARD あり / DEGRADED Sprint あり、ただし本番 URL は稼働
- `failed`: 安全停止発動 or デプロイ未到達

## 各エージェントレポート
- 実装ログ: [[build-log]]
- QA レポート: [[qa-report-sprint{n}]]（Sprint 別）
- デプロイレポート: [[deploy-report]]
- 状態ファイル: [[state]]

## スコープ外検出（[SCOPE_DEFERRED]）
{次回 /ccc-plan-project で v2 候補化推奨}

## 失敗タスク詳細（[FAIL_FORWARD]）
{あれば、ccc-engineer の試行履歴と推定原因}

## 次のアクション
- 本番 URL 動作確認
- v2 計画化（degraded 項目を解消する PRD を作成）
- アーカイブ: completion-report.md が正本。output/_memory/index.md に索引追記済み
- 対応する Linear Issue があれば Done に遷移（`C:/Users/1kkim/projects/scripts/linear/set-state.bat --id {ID} --state Done`）
```

state.md 最終更新:
- `phase: completed | degraded | failed`
- タイムラインに完了イベント記録

### Phase 5: アーカイブ

本コマンド（メインスレッド）が completion-report.md の要約 1 行（テーマ・完了ステータス・URL・degraded 項目数）を `output/_memory/index.md` に追記する（ファイルが無ければ作成。auto モードでも実施）。

---

## エラー処理

| 状況 | interactive | auto |
|---|---|---|
| 入力計画ファイル不在 | 停止 | 停止 |
| CEO 承認 = rejected | 停止 | 停止 |
| 対応外プラットフォーム | 停止 | 停止 |
| Step 2.5 ブロック（gitleaks leak>0 / SAST CRITICAL>0） | 停止 (SECURITY_STOP) | 停止 (SECURITY_STOP) |
| ccc-engineer 3回失敗 | 停止 (ESCALATION) | 続行 (FAIL_FORWARD) |
| ccc-qa 2往復目 Fail | 停止 (STUCK) | 続行 (DEGRADED) |
| Sprint 50%以上 Fail | 停止 | 続行 (SPRINT_DEGRADED) |
| デプロイ前承認 | メインスレッドが承認取得後に devops 起動 | auto_approve: true は自動 / true 以外はメインスレッドが承認取得・記録後に起動 |
| スモークテスト Fail | ユーザー判断 | 自動ロールバック + degraded |
| ロールバック失敗 | 停止 | 停止 |
| state.md I/O 障害 | 停止 | 停止 |

---

## resume 動作の詳細

引数 `resume {project}` で起動された場合:

1. `output/{project}/state.md` を読む
2. `phase` フィールドから現在位置を判定:
   - `planning` → Phase 1 から再開
   - `implementing` → state.md の `current_sprint` / `current_task` から Phase 2-a 再開
   - `qa` → Phase 2-b / 2-d から再開
   - `deploying` → Phase 3 から再開
   - `completed` / `failed` / `degraded` → 「既に完了しています」と表示
3. `## 次のアクション` セクションに書かれているエージェントを起動

resume はコンテキスト溢れ・セッション切れ後の **次セッション** で使う想定。
state.md と該当ログファイルだけ読めば、impl-plan 全文を再ロードせずに継続可能。

---

## ガードレール再掲

- **本コマンドはオーケストレーター。コード生成しない。**
- **状態管理は state.md を正本とする。** ファイル間競合を作らない。
- **モード判定は state.md の `mode` フィールドが正本。** 引数フラグは初期化時のみ反映。
- **auto モードでも絶対の安全線（秘密検出・対応外プラットフォーム・CEO rejected）はバイパスしない。**
- **既存ファイルの更新は Edit による部分更新のみ（全文上書き禁止）。** 新規ファイルの作成（state.md 初期化・completion-report.md・_memory/index.md 生成等）に限り Write を許可する。

各フェーズの進捗を state.md タイムラインに追記しながら逐次報告してください。
