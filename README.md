# 2AIO — AGENT ALL IN ONE

**2AIO は「会社のように動くマルチエージェント」＋「66 の実戦スキル」＋「4 リングのセキュリティ」＋「メモリ / 可観測性 / 自己強化ループ」を 1 リポジトリに統合した、Claude Code 用の総合エージェントフレームワークです。**

取締役会（CEO・CMO・CTO・CSO・CFO）が並列で意思決定し、PRD 生成 → 計画 → 実装 → セキュリティゲート → デプロイまで自律実行。さらに設計・セキュリティ・SDLC・デザインの各領域を、実在の一線級 OSS スキルで武装しています。

```
2AIO
├─ agents/ commands/      … 取締役会 17 体 + ワークフロー 5 コマンド（native）
├─ skills/                … 66 スキル（SDLC / Apple / 設計 / オーケストレーション / リサーチ）
├─ security/              … 4 リング（guardrails → sandbox → scanners → skill-integrity）
├─ memory/                … 永続メモリ層（agentcairn ほか、Obsidian 互換）
├─ observability/         … エージェント挙動・トークン/コストの可視化
├─ catalog/               … 全ツールレジストリ + 外部セキュリティツール宇宙
├─ run.mjs lib/           … 2AIOForge 自己強化ループ（収集→合成→監査→適用）
└─ control.mjs            … 制御プレーン（複数 repo × サブスク枠ガバナー）
```

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
/2aio-autorun-batch {テーマ1} {テーマ2} ...            # バッチ実行
```

### 役員エージェント（17 体）
CEO(opus) / CMO / CTO / CSO / CFO / Planner / Engineer / QA / DevOps / Researcher + 6 検索専門（Web・ニュース・SNS・コミュニティ・Wikipedia・Gemini）。詳細は [ARCHITECTURE.md](./ARCHITECTURE.md)。

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
