# 2AIO — 移植可能な操作モデル（Claude / Codex / Grok 共通）

> このファイルは **host 非依存の 2AIO 操作説明書**。AI CLI が instructions ファイル
> （Codex は `AGENTS.md`、Claude Code は `CLAUDE.md`/hooks、Grok 等も同等）として読み込むと、
> どの AI でも同じ「2AIO の作法」で動く。強制の強さは host の hook 機能に依存する（下記）。

## 中核思想: 賢いモデルが司令塔、安いモデルが実装

- **あなた（駆動している賢いモデル）は司令塔。** 計画・レビュー・統合・判断を持つ。
- **タイピング（大量実装）は安いモデル/AIに委譲する。** トークンを節約する。
- 例外（自分で書く）: 数行の修正、セキュリティ/判断が本質のコード、レビュー・語感判断。

## 実装タスクの標準フロー（plan → delegate → review）

1. **計画** — 実装せずに計画を固める。可能なら計画サブエージェント（Claude Code: `2aio-planner`）に起案させ、賢いモデルが精査して次を必ず埋める:
   - 測定可能な受け入れ条件（「動くか」でなく「Xが存在しYを返す」）
   - エッジケースの決着（曖昧さを実装側に丸投げしない）
   - 触る/触らないファイル、既存規約
   - UI なら `## デザイン品質`（路線を1つに振り切る／パレット／タイポ／状態デザイン／量産型AI UI 禁止）
   計画は `.ai/codex_brief_<slug>.md` に書く。
2. **委譲** — 実装を安いモデル/AIに投げる（下記 provider ルーティング）。
3. **レビュー統合** — 出力を受け入れ条件で検証し、テスト緑を確認して統合。ダメなら是正して差し戻す。

## Provider / モデル ルーティング（マルチAI 自動切替の基準）

タスクに「一番安く十分な」provider+モデルを選ぶ:

| タスク性質 | 推奨 |
|---|---|
| 機械的・雛形・一括・整形 | 最安クラス（Codex Luna / Claude Haiku） |
| 通常の実装（明確な仕様から） | 中位（Codex Terra / Claude Sonnet） |
| 難しい実装・深い推論・アーキ判断 | 上位（Codex Sol / Claude Opus）※高価、必要時のみ |
| リアルタイム/SNS/最新情報の調査 | 得意な provider（例: xAI Grok）に委譲 |
| 計画・レビュー・語感/CJK判断 | 賢いモデルが自分で持つ（委譲しない） |

**既定は中位。上位は「明示的に難しい」時だけ。** 具体的なモデルIDやルールはコアの JSON で管理:
`harness/model-router/routing-rules.json`（Claude 階層）、`harness/codex-router/routing-rules.json`（Codex 階層）。

## 委譲の呼び方（コアは共通スクリプト）

- **Codex へ委譲:** `bash harness/codex-router/codex-run.sh --write -C <dir> "<task or 'implement .ai/codex_brief_*.md exactly'>"`
  - 自動でモデル選択（`--why` で確認）、stdin閉じ・10MBログ上限・構造化出力・sandbox・**brief必須（既定）**・使用ログ `~/.claude/logs/2aio-usage.jsonl`。
- **任意の OpenAI互換 AI へ委譲/相談:** `bash harness/providers/ai-run.sh --provider <name> "<prompt>"`
  （provider は `harness/providers/providers.json` に定義＝openai / xai(Grok) / deepseek / groq / ローカル ollama…。データで追加可。鍵は env のみ）。最新情報・SNS・別視点のレビュー等に使う。
- **並列で複数AIに割る:** タスクを disjoint に分割してから各 provider に投げる（Claude Code: `agent-task-splitter`）。

## 安全（全 host 共通・絶対）

- **不可逆・外部作用は自動でやらない**（大量削除 / force push / DB drop / デプロイ / 公開）。必ず確認。
- **強権限トークン（service_role 等）を chat にも brief にも書かない。** env 名のみ渡す（過去に PAT 流出の経緯あり）。
- 委譲先の出力は**必ず賢いモデルがレビューしてから統合**。無検証マージ禁止。
- 秘密をログに出さない。機能を壊さない（各修正後にテスト緑を確認）。

## host ごとの強制の強さ（正直な差）

| host | 常時強制（guard/enforcer/advisor 自動発火） | 導入 |
|---|---|---|
| **Claude Code** | ✅ 強（PreToolUse/UserPromptSubmit hook） | `harness/install-harness.sh` |
| **Codex** | ⚠️ 中（この AGENTS.md の常時指示 + `~/.codex/config.toml` の approval/sandbox + notify hook から guard 呼び出し） | この AGENTS.md を repo/`~/.codex/` に置く |
| **Grok / その他** | ⚠️ CLI 次第（instructions ファイルを読むなら本ファイルを置く。hook が無ければ"指示ベース"の弱い強制） | 本ファイルを instructions として読ませる |

どの host でも **コア（guard.py / router / codex-run.sh / rules）は共通**。違うのは「どれだけ自動で強制されるか」だけ。hook を持つ host ほど強い。
## Public command surface

`commands/` contains three entry points: `/2aio-create` (build from scratch —
selects quick `2aio-build` or full start/plan/implement mode), `/2aio-check`
(audit an existing repo, then either remediate after approval or file the
findings as GitHub Issues without touching code), and `/2aio-dev` (add a
feature or fix a bug in an already-running repo, feature/fix submodes). Before
adding a fourth public command, check whether the need fits inside one of
these three first — the surface stays small on purpose so users don't have to
memorize a lane taxonomy. The ten detailed workflows live in `lanes/` and are
installed under `~/.claude/2aio/lanes/`. `/2aio-create` and `/2aio-check` hold
real dispatch logic inline; `/2aio-dev` is a pure pointer to the
self-contained `lanes/2aio-dev.md` (2aio-dev has no sibling lanes to choose
between, so there is nothing to dispatch). Do not copy lane contents back into
public command files.

## Codex から 2AIO を起動する（入口の host 差分）

Claude Code の slash command（`/2aio-create` / `/2aio-check`）は frontmatter 解釈に
依存するため Codex ではそのまま動かない（`/2aio-create` と打っても出てこない）。

**正規の入口: Skill（`install.sh` / `install.ps1` を実行済みなら使える）**
`skills/2aio/2aio-create/`・`skills/2aio/2aio-check/`・`skills/2aio/2aio-dev/` は
Codex/Claude 共通の SKILL.md 形式（`name` + `description` frontmatter）で書かれており、
インストーラが `~/.claude/skills/` と `~/.codex/skills/`（Codex が既に入っている場合のみ）
の両方に配備する。Codex 側では `/skills` メニューまたは `$2aio-create` / `$2aio-check` /
`$2aio-dev` で明示呼び出しできる。自然文で「アプリを作りたい」等と伝えた場合も description
マッチで暗黙起動しうる。**未インストール／未 update の場合はまず
`bash install.sh --update` または `pwsh install.ps1 -update` を実行する。**

**フォールバック（Skill が未配備でも動く）**: **コマンドファイルを直接 Read し、
その手順を自分の指示として実行する**ことで同じ入口を再現できる:

- 「一から作る」: `~/.claude/commands/2aio-create.md`（無ければリポジトリ直下の
  `commands/2aio-create.md`）を Read し、$ARGUMENTS を
  「<作りたいもの> [--quick|--full] [--auto]」として、その手順（規模判定 → レーン選択 →
  レーン実行）に厳密に従う。
- 「既存プロジェクトの評価」: 同様に `2aio-check.md` を Read し、$ARGUMENTS を
  「[path] [--report-only] [--dimensions=...]」として従う。
- 「既存プロジェクトで機能実装・バグ修正」: 同様に `2aio-dev.md` を Read し、$ARGUMENTS を
  「<repoパス> <機能記述 | --fix バグ報告/Issue文> [--auto] [--pr]」として従う。
- 手順文中の `~/.claude/2aio/lanes/` はグローバル配備先（Claude Code 専用ではない、
  ただのファイルパス）。Codex もそのまま Read してよい（内容は同一。lane 側には既に
  「`/2aio-<name>` は旧スラッシュコマンド表記 → レーンファイルを Read して読み替える」
  という注記がある）。

### host 差分の読み替え（Codex 実行時に自動で適用する）

- **並列 Task 起動**（例: `2aio-check` の4観点並列監査、`2aio-start-project` の CMO/CTO 同時起動）:
  Codex に並列サブエージェント起動手段は無い。指示された各エージェント役割を1つずつ
  `agents/<name>.md` として Read し、順番に自分で実行する（結果は同等、所要時間のみ延びる）。
- **AskUserQuestion tool**: Codex にはこの tool が無い。会話内でユーザーに直接質問し、
  回答を待てばよい（選択肢の提示も地の文でよい）。
- **サブエージェント起動（Task 単体）**: `agents/<name>.md` を Read し、本文の役割・手順・
  制約を自分のロール指示として採用してタスクを遂行する。frontmatter の `model:` / `tools:` は
  Claude Code 専用のモデル階層・権限設定なので無視してよい（かわりにこのファイル冒頭の
  provider/モデルルーティング表に従う）。
- この節が host 差分の正本。`lanes/` / `agents/` / `commands/` は Claude Code の実挙動を
  変えないため書き換えない。
