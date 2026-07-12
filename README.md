<<<<<<< HEAD
# 2AIO — AGENT ALL IN ONE

**2AIO は「会社のように動くマルチエージェント」＋「66 の実戦スキル」＋「4 リングのセキュリティ」＋「メモリ / 可観測性 / 自己強化ループ」を 1 リポジトリに統合した、Claude Code 用の総合エージェントフレームワークです。**

取締役会（CEO・CMO・CTO・CSO・CFO）が並列で意思決定し、PRD 生成 → 計画 → 実装 → セキュリティゲート → デプロイまで自律実行。さらに設計・セキュリティ・SDLC・デザインの各領域を、実在の一線級 OSS スキルで武装しています。

```
2AIO
├─ agents/ commands/      … エージェント 25 体 + ワークフロー 8 コマンド（native）
├─ harness/               … ライブハーネス（guard / model・skill ルーティング / Codex委譲 / enforcer / front-door / providers）
├─ AGENTS.md adapters/    … クロスhost 操作モデル（Claude / Codex / 任意の OpenAI 互換 AI 共通）
├─ skills/                … 66 スキル（SDLC / Apple / 設計 / オーケストレーション / リサーチ）
├─ security/              … 4 リング（guardrails → sandbox → scanners → skill-integrity）
├─ memory/                … 永続メモリ層（agentcairn ほか、Obsidian 互換）
├─ observability/         … エージェント挙動・トークン/コストの可視化
├─ catalog/               … 全ツールレジストリ + 外部セキュリティツール宇宙
├─ run.mjs lib/           … 2AIOForge 自己強化ループ（収集→合成→監査→適用）
└─ control.mjs            … 制御プレーン（複数 repo × サブスク枠ガバナー）
```

---

## ⚙️ ライブハーネス（最重要 — Claude 司令塔 → Codex 実装）

2AIO は「入れるだけのファイル群」ではなく、**毎セッションを 2AIO の作法で走らせる稼働レイヤー**を持ちます。
中核思想は **賢いモデル（Claude）が司令塔＝計画・レビュー・統合・判断を持ち、大量のタイピング（実装）は
安いモデル/AI（Codex Terra/Luna ほか）に委譲する**こと。トークンを節約しつつ品質は賢いモデルが担保します。

```bash
bash harness/install-harness.sh    # 武装: guard + 4 advisor + enforcer を settings.json に非破壊マージ
```

| 部品 | 役割 |
|---|---|
| **guard**（Ring-1 PreToolUse） | 不可逆・漏洩アクションを実行前に遮断。全ツール呼び出しを監査ログ化 |
| **model / skill ルーティング** | タスクからモデル階層を動的選択（launch 時に実切替）＋ JP↔EN でスキルを確実に発火 |
| **Codex 委譲**（`codex-router/`） | `codex-run.sh` が安全に `codex exec` を実行。**brief 必須**（計画を保証）＋使用ログ |
| **enforcer**（`enforce/`） | Claude が大量の新規実装ファイルを直書きするのを**ハード遮断**し委譲を強制。司令塔役は温存（Edit/計画/レビューは常時許可） |
| **front-door**（`front-door/`） | 素のプロンプトから適切な 2AIO パイプライン（harden / board / redesign / research）へ誘導 |
| **providers**（`providers/`） | `ai-run.sh --provider <name>` で任意の OpenAI 互換 AI（openai / xai / deepseek / groq / ローカル ollama…）へ委譲。鍵は env のみ |

- **委譲の起動:** `/2aio-delegate "<実装タスク>"`（計画→brief→Codex→レビュー統合）。UI タスクは自動でデザイン品質 directive を付与。
- **クロスhost:** 操作モデルの正本は [`AGENTS.md`](./AGENTS.md)（Codex はネイティブに読む）。host 別導入は [`adapters/README.md`](./adapters/README.md)。
- 詳細と正直な限界（全操作の自動強制は hook を持つ Claude Code のみ完全）は [`harness/README.md`](./harness/README.md)。

---

## Part 1 — マルチエージェント（native）

### インストール
```bash
bash install.sh        # macOS / Linux
```
=======
# CCC: Claude Code Company + CCCForge 自己強化ループ

**CCC は会社のように動作するマルチエージェント・オーケストレーション・フレームワークです。** 取締役会（CEO・CMO・CTO・CSO・CFO）のように複数のエージェントが並列に意思決定し、PRD 生成・計画・実装・デプロイまで完全自動化します。

さらに **CCCForge**（自己強化ループ）を同梱。CCC の設計知識・スキルを Web 検索と**ローカルLLM (Ollama)** で常時自動更新し、監査役の検証を通ったものだけを安全に反映します。

## 構成

| 領域 | 内容 |
|------|------|
| `agents/` `commands/` | CCC マルチエージェント（役員17体 + ワークフローコマンド） |
| `run.mjs` `lib/` `config.json` | CCCForge 自己強化ループ（収集→合成→監査→適用/提案） |
| `dashboard.mjs` | 監視・手動実行・提案の承認/却下・履歴 rollback |
| `control.mjs` | 制御プレーン（複数repoを1画面で進行 / サブスク枠ガバナー＋ジョブキュー）→ [docs/CONTROL-PLANE.md](./docs/CONTROL-PLANE.md) |
| `test/` | 安全分岐・承認反映・ガバナー/キューの回帰テスト（`node --test`） |

---

## Part 1: CCC マルチエージェント・ワークフロー

### インストール

**Windows (PowerShell)**
>>>>>>> origin/claude/repos-consolidation-ccc-5e5933
```powershell
./install.ps1          # Windows
```
`agents/` `commands/` `skills/` を `~/.claude/` に配備します（**既存スキルは上書きしません** — ECC セーフ）。

<<<<<<< HEAD
### 使い方
=======
**macOS / Linux**
>>>>>>> origin/claude/repos-consolidation-ccc-5e5933
```bash
/2aio-start-project "沖縄観光 AI 案内チャットボット"   # 取締役会 → PRD
/2aio-plan-project {prd-file}                          # 実装計画（WBS）
/2aio-implement-project {impl-plan-file}               # 実装 → QA → デプロイ
/2aio-build {テーマ} --auto                            # 超高速レーン（PRD 不要）
/2aio-delegate "<実装タスク>"                          # 計画 → Codex 委譲 → レビュー統合
/2aio-harden [--dimensions=...]                        # 既存システムを全次元で自律強化（loop-until-clean）
/2aio-autorun-batch {テーマ1} {テーマ2} ...            # バッチ実行
```

<<<<<<< HEAD
### エージェント（25 体）
**取締役会 + 実装 17 体:** CEO(opus) / CMO / CTO / CSO / CFO / Planner / PRD / Engineer / QA / DevOps / Researcher + 6 検索専門（Web・ニュース・SNS・コミュニティ・Wikipedia・Gemini）。
**追加 8 体（description に「PROACTIVELY 使う」を持ち自動起動）:** frontend-engineer（UI 実装リード）/ design-reviewer / swift-reviewer / ios-debugger / observability / migration-runner / release-manager / project-auditor。
詳細は [ARCHITECTURE.md](./ARCHITECTURE.md) と [harness/README.md](./harness/README.md)。

---

## Part 2 — スキル（66・vendored）

一線級 OSS を **MIT ライセンスのまま再配布**。各スキルに `SOURCE.md`、全体索引は [`skills/SOURCES.md`](./skills/SOURCES.md)。

| カテゴリ | 数 | 出典 |
|---|---|---|
| `sdlc/` — spec/tdd/debug/perf/security-hardening ほか | 24 | addyosmani/agent-skills |
| `apple/` — SwiftUI / iOS / macOS | 9 | Dimillian/Skills |
| `engineering/` — review-swarm / bug-hunt / batch-refactor ほか | 7 | Dimillian/Skills |
| `design/` — taste / brutalist / minimal / ui-craft / styleseed ほか | 17 | taste-skill, ui-craft, styleseed |
| `orchestration/` — agent-debate / task-splitter / shared-memory / fable-mode | 8 | agent-collab-skills, fable-mode |
| `research/` — last30days（SNS/HN 横断検索） | 1 | mvanhorn/last30days-skill |
| `design-references/` — 日本語デザイントークン（テンプレ+サンプル） | — | kzhrknt/awesome-design-md-jp |

---

## Part 3 — セキュリティ（4 リング）

自律エージェントの多層防御。詳細は [`security/README.md`](./security/README.md)。

| リング | 役割 | 代表ツール |
|---|---|---|
| 1. Guardrails | 破壊的/漏洩アクションをフック前段で遮断 | agent-guard, safety-net, GouvernAI |
| 2. Sandbox | エージェントをコンテナ/VM で隔離 | cleat, brood-box, code-on-incus, authsome |
| 3. Scanners | 生成コードを SAST/secret/IaC/サプライチェーン走査 | Bearer, Checkov, KICS, gitleaks, is-website-vulnerable |
| 4. Skill Integrity | 自分が使うスキル自体の汚染/ドリフト検知 | SkillSpector(NVIDIA), SkilLock |
=======
### 使い方
>>>>>>> origin/claude/repos-consolidation-ccc-5e5933

```bash
bash security/scanners/scan.sh .   # 導入済みスキャナを全実行 → 集約 → 秘密漏洩は非ゼロ終了
```
外部セキュリティツール宇宙（network/threat-intel/red-blue-team/forensics ほか）は
[`catalog/security-tools.md`](./catalog/security-tools.md)。**防御・許可済みテスト用途に限定。**

<<<<<<< HEAD
---
=======
### 役員エージェント（17体）
>>>>>>> origin/claude/repos-consolidation-ccc-5e5933

## Part 4 — メモリ / 可観測性

<<<<<<< HEAD
- **メモリ** [`memory/README.md`](./memory/README.md): 既定は **agentcairn**（Obsidian 互換で `state.md` と親和）。`presence`/`roampal-core` で成果ベースの学習ゲート。
- **可観測性** [`observability/README.md`](./observability/README.md): `agents-observe` / `Claude-Code-Agent-Monitor` でサブエージェント木・トークン/コストを可視化。制御プレーンの予算管理と補完関係。

---

## Part 5 — 2AIOForge 自己強化ループ

- **2AIOForge**（`run.mjs` + `lib/`）: Web 検索 → ローカル LLM(Ollama) が更新案起草 → 監査 → 適用/提案。自動適用は「vault × 低リスク × 監査 PASS」のみ。skills/agents は必ず提案（承認制）。
  ```bash
  node run.mjs           # 全トピック（Ollama 前提）
  node dashboard.mjs     # 監視・承認/却下・rollback → http://localhost:7878
  ```
- **制御プレーン**（複数 repo × サブスク枠ガバナー、`control.mjs`）は別ブランチ
  `claude/repos-consolidation-ccc-5e5933` に実装済み。本統合ブランチにマージすると
  `npm run control`（http://localhost:7900）で利用可能。

---

## 全体像・レジストリ
統合済み/カタログ済みの全ツール索引: [`catalog/tool-registry.md`](./catalog/tool-registry.md)。
アップストリームのソースは `dev/skills/_review/<category>/<repo>/` にステージング（git 管理外）。
=======
設計判断・原則・トラブルシューティングは [ARCHITECTURE.md](./ARCHITECTURE.md) を参照。

---

## Part 2: CCCForge 自己強化ループ（ローカルLLM主体）

CCC（Claude向け設計知識・スキル）を**常時自動で最新化**する。Web検索で最新情報を集め、**ローカルLLM(Ollama)** が更新案を起草、監査役が検証。自動適用は「**vault × 低リスク × 監査PASS**」の全条件成立時のみで、それ以外（skills・高リスク・監査NG・`--dry`）はすべて提案（承認制）。

### パイプライン
```
収集(Web検索) → 合成(ローカルLLMが更新案を起草) → 監査 → 提案/適用 → 記録
```
- **ローカルLLM**: Ollama。モデルは `config.json` の `model`（現在 `qwen2.5:14b`）。URLは `OLLAMA_URL` 環境変数 > `config.json` の `ollamaUrl` > `http://localhost:11434` の順で決まる。
- **検索**: Tavily（`TAVILY_API_KEY` あれば優先）→ 無ければ DuckDuckGo（キーレス・フォールバック）。
- **監査**: `config.json` の `auditBackend` で切替。
  - `claude`（現在の設定）: ヘッドレス Claude が4観点を1コールで監査。失敗時はローカルにフォールバック。
  - `local`: ローカルLLMの多役クリティック。`factuality / hallucination / ccc-fit / safety` の4役が個別判定。
  - NGなら指摘を反映して改稿（最大 `auditRounds` 回）。
- **適用方式（安全）** — 判定ロジックは `lib/policy.mjs` に一元化:
  - **自動適用 = vault × risk:low × 監査PASS のみ** → `vault/knowledge/auto/*.md` に書き込み（適用前バックアップ＋履歴記録、rollback可）。
  - **それ以外はすべて提案** → `proposals/*.md`（＋機械可読な `.json` サイドカー）。skills/agents・高リスク・監査NG・`--dry` が該当。人がダッシュボードで承認して反映する。

### 使い方
```bash
# 全トピック実行（Ollama稼働が前提）
node run.mjs
# 1トピックだけ
node run.mjs --topic=web-security
# 適用せず提案だけ出す（全トピックがproposalsに落ちる）
node run.mjs --dry

# ダッシュボード（実行・監視・提案の承認/却下・履歴rollback）
node dashboard.mjs   # → http://localhost:7878 （ローカル限定バインド）

# テスト（安全分岐・承認反映）
node --test
```
- 設定: `config.json`（model / auditBackend / topics / queries / target(vault|skill) / risk / auditRounds）。`paths` の相対パスはこの repo 基準で解決される。
- 出力: 自動適用→`vault/knowledge/auto/`、提案→`proposals/`、実行ログ→`runs/<日付>.json`。
- 提案の承認: ダッシュボードの「提案（承認待ち）」から **承認して反映**（バックアップ付き・書き込み先は vault/skills 配下に限定）または **却下**（`proposals/rejected/` にアーカイブ）。

### Tavilyキー（高品質検索にする場合）
```powershell
setx TAVILY_API_KEY "tvly-xxxxxxxx"   # User環境変数に永続化（再起動後のシェルで有効）
```
※未設定でもDuckDuckGoで動く（質は中程度）。**service_role等の強い鍵は置かない**。

### 常時化（cron相当 = Windows タスクスケジューラ）
毎日朝に自律実行する例（PowerShell・管理者不要のユーザータスク）:
```powershell
$act = New-ScheduledTaskAction -Execute "node.exe" -Argument "run.mjs" -WorkingDirectory "C:\Projects\dev\ccc"
$trg = New-ScheduledTaskTrigger -Daily -At 7:00am
Register-ScheduledTask -TaskName "CCCForge-daily" -Action $act -Trigger $trg -Description "CCC自己強化ループ"
```
※Ollamaが起動している時間に合わせる。`auditBackend: "local"` にすればClaude不要・完全ローカルで回る。

### 設計上の安全
- skills/agents は**絶対に自動上書きしない**（提案→承認）。IDDガードレール「ECC本体を上書きしない」と整合。
- **監査NGも自動適用しない**（提案に落とす）。自動適用はvault知識（低リスク・差し替え容易）×監査PASSに限定。
- 承認による反映も `applyWithHistory()` 経由（適用前バックアップ・履歴記録・rollback可）。書き込み先は config の vault/skills 配下のみ許可。
- すべての実行は `runs/` に記録（何を・どの出典で・監査結果・applied/proposed）。
- この安全分岐は `test/` の node:test で回帰検証される（skill/high/監査NG/dry が自動適用されないこと等）。

---

## Part 3: 制御プレーン（複数repoを1画面で進行）

**1つのダッシュボードで複数repoを進行**させ、**Claudeサブスク（Max）の共有5時間ブロック**を食い潰さないよう、ジョブを予算ガバナーで直列/少数並列に消化する司令塔。設計の詳細は [docs/CONTROL-PLANE.md](./docs/CONTROL-PLANE.md)。

```bash
npm run control    # → http://localhost:7900
```
- **リポジトリ登録（HTTPS）**: 画面から Git URL を登録すると `workspaces/` に clone。
  - **新規repo**（コード無し）→ ダッシュボード上で **Claudeが1問ずつ対話ヒアリング**（`lib/intake.mjs`）→ 要件が揃うと計画・実装ジョブを自動投入。
  - **既存repo**（コード有り）→ **解析ジョブ**でコード/docs/(gh があれば)Issueを読み、目的理解・改善案・CCC強化ポイントを出力。
  - 新規/既存の判定は `lib/repo.mjs`（`classifyRepo`）。private は事前に git 認証が必要。
- **5時間ブロックの使用状況**: `ccusage` から使用率(%)・使用/上限トークン・reset目安を常時表示。取得不可時は `/api/debug` で診断。
- **ガバナー**（`lib/governor.mjs`）: 使用率が閾値（既定80%）以上なら新規投入を停止→reset後に自動再開。同時実行は既定1（サブスク枠共有のため直列が安全）。
- **キュー**（`lib/queue.mjs`）: 投入ジョブを `control/queue.json` に永続化。`build`/`start`/`plan`/`implement`/`analyze` を各repoへ委譲。
- 設定は `config.json` の `governor: { tokenThreshold, maxConcurrency, pollMs }`。127.0.0.1限定バインド（LAN公開・複数ホスト集約は将来フェーズ）。`claude` バイナリは `CLAUDE_BIN`/`CCC_CLAUDE_BIN` で指定可。

---

## ファイル
- `agents/` … CCC 役員エージェント定義（17体）
- `commands/` … CCC ワークフローコマンド（start-project / plan / implement / build / autorun-batch）
- `install.ps1` `install.sh` … CCC エージェント/コマンドのインストーラ
- `run.mjs` … CCCForge オーケストレータ（収集→合成→監査→適用/提案）
- `dashboard.mjs` … 監視・手動実行・提案の承認/却下・履歴rollback（http://localhost:7878）
- `control.mjs` … 制御プレーン: 複数repo進行・サブスク枠ガバナー＋キュー（http://localhost:7900）
- `lib/governor.mjs` … トークン予算ガバナー（サブスク5hブロックの入場判定・純ロジック）
- `lib/queue.mjs` … 制御プレーンのジョブキュー（永続化・状態遷移）
- `lib/repo.mjs` … Git URL解析・新規/既存判定（clone作業ツリーの分類）
- `lib/intake.mjs` … 新規repoの対話ヒアリング（質問生成・応答検証・brief→実装プロンプト）
- `lib/policy.mjs` … 自動適用可否の判定（安全設計の一元実装）
- `lib/proposals.mjs` … 提案の解決・承認反映・アーカイブ
- `lib/paths.mjs` … config パス解決・書き込み先の境界チェック
- `lib/ollama.mjs` … Ollama呼び出し（JSONモード）
- `lib/search.mjs` … Tavily / DuckDuckGo
- `lib/history.mjs` … バックアップ付き適用・履歴・rollback
- `config.json` … トピックと方針
- `test/` … 安全分岐・承認反映のテスト（`node --test`）
- `proposals/` `runs/` `history/` … 提案・実行ログ・変更履歴（git管理外）
>>>>>>> origin/claude/repos-consolidation-ccc-5e5933

## ライセンス
2AIO 本体: MIT。同梱スキル/参照ツールは各アップストリームのライセンス（大半 MIT、一部 Apache-2.0 / Elastic-2.0）に従い再配布。詳細は各 `SOURCE.md` と [`skills/SOURCES.md`](./skills/SOURCES.md)。
