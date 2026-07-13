---
description: 既存repo開発レーン。動いているリポジトリへの機能追加（feature）とバグ修正（fix）を、取締役会・PRD・リサーチ7体をバイパスして最短で回す。終端はデプロイではなく feature ブランチ + commit（PR はオプション）。
argument-hint: <repoパス> <機能記述 | --fix バグ報告/Issue文> [--auto] [--pr]
---

> **表記の読み替え:** 本文中の `/2aio-<name>` は旧スラッシュコマンド表記。`~/.claude/2aio/lanes/2aio-<name>.md` を Read し、後続テキストを $ARGUMENTS としてその指示に従う意味に読み替える。

既存リポジトリに **1機能足す / バグを直す** ための第3レーン。ゼロから作って公開する既存5レーンと違い、
対象 repo の規約・スタック・テスト構成に**合わせて**最小差分で作業する。

**対象:** $ARGUMENTS

## 引数とサブモード

| パターン | 意味 |
|---|---|
| `{repoパス} {機能記述}` | **feature モード**: 機能追加 |
| `{repoパス} --fix {バグ報告}` | **fix モード**: バグ修正（再現手順・エラーログ・Issue 文を入力に） |
| `--auto` | 自律実行（fix モードの挙動差は下記） |
| `--pr` | 終端で push + `gh pr create` まで行う（既定は ローカル feature ブランチ + commit のみ） |
| `resume {repo-slug}` | state.md から再開（/2aio-implement-project の resume パターンを流用） |

## 役割と絶対制約

- **成果物の置き場を固定**: state.md / conventions.md / build-log.md / qa-report.md は
  `output/{repo-slug}/`（2aio-output 正本・原則5）に置く。**対象 repo には実装コードとテスト以外を書き込まない**（repo 汚染防止）。
- **対象 repo の規約が正本**: 2AIO の流儀ではなく、解析で抽出した conventions.md（既存規約・スタック・テスト構成）に従う。
- **push / PR は外向きアクション**（原則2を類推適用）: interactive は承認必須。state.md に
  `push_approved: true` / `push_approved_at` を記録してから実行。auto も `--pr` 明示がない限り push しない。
- **control.mjs の queue kind への 'dev' 追加は本レーンのスコープ外（v2）。**

## モード仕様

| | feature | fix |
|---|---|---|
| interactive | 詰まったら停止 | 詰まったら停止 |
| auto | FAIL_FORWARD 可（implement レーンと同じ） | **FAIL_FORWARD 禁止・ESCALATION 固定**（誤った「直ったつもり」を出さない） |

fix モードの auto 挙動は state.md の `lane: dev-fix` フィールドで engineer に伝える（engineer 側モード表の1行拡張）。

## 実行フロー

### Phase 0: state.md 初期化（/2aio-implement-project Phase 0 パターン流用）

`output/{repo-slug}/state.md` を作成。frontmatter は implement-project 版をベースに:

```yaml
lane: {dev-feature | dev-fix}
repo_path: {対象repoの絶対パス}
push_approved: false
pr_url: null
```

を追加（`sprints_total` 等の Sprint 系フィールドは持たない — 本レーンに Sprint 概念はない）。
resume は implement-project と同じく `phase` フィールドから再開位置を判定する。

### Phase 1: コードベース解析（メインスレッド）

対象 repo を読み、`output/{repo-slug}/conventions.md` に抽出:
- 言語・フレームワーク・パッケージマネージャ・ビルド/テスト/lint コマンド（package.json scripts 等）
- ディレクトリ構造の規約（テストの置き場・命名）
- 既存のコードスタイル（コメント密度・命名・イディオム）
- git のデフォルトブランチ・ブランチ命名規約（あれば）

### Phase 2: 計画

**feature モード:**
1. 軽量 spec を `output/{repo-slug}/spec.md` に生成（主要機能・受け入れ条件・スコープ外。
   既存 UI がある repo では design 工程（路線選択）は**スキップ** — 既存デザインへの追従が正）。
2. `2aio-planner` を `--lite` で起動（タスク表＋依存のみ。工数・スプリント分割なし）。

**fix モード:**
1. 再現確認: バグ報告の再現手順を実行し、実際に失敗することを確認して build-log.md に記録
   （再現しない場合: interactive は停止して報告 / auto も **ESCALATION**（推測修正はしない））。
2. 計画は「失敗する回帰テスト → 最小修正」の2ステップ固定。planner は起動しない。

### Phase 3: 実装（2aio-engineer）

feature ブランチを確保してから起動: `git checkout -b 2aio/dev-{slug}`（repo が git 未初期化なら `git init`）。

- **feature**: impl-plan（--lite）を計画正本として通常の WBS 準拠で実装。
- **fix**: スコープ防衛を作業単位版に読み替える —
  **「再現テストが赤→緑になる最小差分のみ」**。リファクタ・ついで修正は禁止。
  1. バグを再現する **失敗するテスト** を先に作成（RED 確認）
  2. 最小修正（GREEN）
  3. **全テスト実行**（回帰ゲート）
- テスト基盤が無い repo のフォールバック:
  最小のテストランナー導入は `[NEW_DEP]` 扱い（interactive はユーザー確認 / auto は導入せず
  **再現スクリプト（exit code 検証）で代替**）。どちらも build-log.md に記録。

### Phase 4: QA（2aio-qa・最大2往復）

受け入れ条件正本: feature は spec.md / fix は「再現テストが緑 + 既存テスト全緑」。
conventions.md 記載のビルド・テスト・lint コマンドで全体検証（#8 の非交渉ゲートと同じ意味論）。

### Phase 5: 終端 — commit / PR（デプロイはしない）

1. conventional commits 形式でコミット（`feat: ...` / `fix: ...`）。
2. **push / PR 前セキュリティゲート（/2aio-build --local の Phase 5-pre と同形式・メインスレッド直接実施）**:
   push 対象コミットに対し gitleaks（未導入時は devops Step 2.5 のフォールバック規定を流用）+
   環境変数 `SECURITY_SCAN_MJS` があれば `node $SECURITY_SCAN_MJS {repo}` を実行（無ければ gitleaks / レビューで代替）。
   **leak>0 / CRITICAL>0 はモード問わず push 禁止**（`[SECURITY_STOP]` を state.md に記録）。
3. `--pr` 指定時のみ: 承認取得（interactive）→ `push_approved` 記録 → push → `gh pr create`
   （qa-report の要約を PR 本文に添付）→ `pr_url` を state.md に記録。
4. `--pr` なし: ローカル feature ブランチ + commit で完了。push コマンドを完了報告に提示するのみ。

### Phase 6: 完了

state.md を `phase: completed` に更新。完了報告: ブランチ名・コミット・変更ファイル・QA 結果・（あれば）PR URL。

## ガードレール

- 取締役会・PRD・リサーチ・デザイン路線選択を**復活させない**（バイパスがこのレーンの存在意義）。
- fix モードで「ついでにこの周辺も直す」は禁止。`[SCOPE_DEFERRED]` で記録して手を出さない。
- デプロイはしない。デプロイしたければ既存レーン（/2aio-build・/2aio-implement-project）を使う。
- セキュリティゲートの正本は devops Step 2.5（本レーンは devops を経ない例外レーンとして、同等条件をメインスレッドで1回だけ実施）。
