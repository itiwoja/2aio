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
```powershell
./install.ps1          # Windows
```
`agents/` `commands/` `skills/` を `~/.claude/` に配備します（**既存スキルは上書きしません** — ECC セーフ）。

### 使い方
```bash
/2aio-start-project "沖縄観光 AI 案内チャットボット"   # 取締役会 → PRD
/2aio-plan-project {prd-file}                          # 実装計画（WBS）
/2aio-implement-project {impl-plan-file}               # 実装 → QA → デプロイ
/2aio-build {テーマ} --auto                            # 超高速レーン（PRD 不要）
/2aio-delegate "<実装タスク>"                          # 計画 → Codex 委譲 → レビュー統合
/2aio-harden [--dimensions=...]                        # 既存システムを全次元で自律強化（loop-until-clean）
/2aio-autorun-batch {テーマ1} {テーマ2} ...            # バッチ実行
```

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

```bash
bash security/scanners/scan.sh .   # 導入済みスキャナを全実行 → 集約 → 秘密漏洩は非ゼロ終了
```
外部セキュリティツール宇宙（network/threat-intel/red-blue-team/forensics ほか）は
[`catalog/security-tools.md`](./catalog/security-tools.md)。**防御・許可済みテスト用途に限定。**

---

## Part 4 — メモリ / 可観測性

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

## ライセンス
2AIO 本体: MIT。同梱スキル/参照ツールは各アップストリームのライセンス（大半 MIT、一部 Apache-2.0 / Elastic-2.0）に従い再配布。詳細は各 `SOURCE.md` と [`skills/SOURCES.md`](./skills/SOURCES.md)。
