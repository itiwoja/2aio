# 2AIO — AGENT ALL IN ONE

**2AIO は「会社のように動くマルチエージェント」＋「66 の実戦スキル」＋「4 リングのセキュリティ」＋「メモリ / 可観測性 / 自己強化ループ」を 1 リポジトリに統合した、Claude Code 用の総合エージェントフレームワークです。**

取締役会（CEO・CMO・CTO）が並列で意思決定し、PRD 生成 → 計画 → 実装 → セキュリティゲート → デプロイまで自律実行。さらに設計・セキュリティ・SDLC・デザインの各領域を、実在の一線級 OSS スキルで武装しています。

```
2AIO
├─ agents/ commands/      … エージェント 25 体 + 入口 2 コマンド（create / check）
├─ lanes/                 … 内部ワークフローレーン 10 本（入口・制御プレーンが自動選択）
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

## 🚀 クイックスタート — 入れてから使うまで

### 前提
- **Claude Code** 導入済み（`~/.claude/` が存在すること — インストーラが確認します）
- **git**、および Forge / 制御プレーンを使う場合は **Node.js 20+**
- 任意: **Codex CLI**（実装委譲の実行先）、**Ollama**（2AIOForge のローカルLLM）

### 1. clone してインストール
```powershell
git clone https://github.com/itiwoja/2aio.git
cd 2aio
./install.ps1          # Windows (PowerShell)
```
```bash
git clone https://github.com/itiwoja/2aio.git
cd 2aio
bash install.sh        # macOS / Linux
```
`agents/`（25 体）`commands/`（入口 2 個）`lanes/`（内部レーン 10 本 → `~/.claude/2aio/lanes/`）`skills/`（66 個）を配備します（**既存スキルは上書きしません** — ECC セーフ）。
セキュリティ / メモリ / 可観測性は外部ツール — 各 README に従って個別導入してください。

### 2.（任意）ライブハーネスを有効化
毎セッションを 2AIO の作法（guard / ルーティング / Codex 委譲 / enforcer）で走らせる場合:
```bash
bash harness/install-harness.sh    # guard + 4 advisor + enforcer を settings.json に非破壊マージ
```

### 3. Claude Code を再起動して動作確認
新しいセッションを開き、コマンドとエージェントが認識されているか確認します:
`/2aio-` と打って補完に **`/2aio-create` と `/2aio-check` の 2 つ**が出れば導入成功です。使うのはこの 2 つだけです:
```bash
/2aio-create "ポモドーロタイマー PWA" --quick   # 一から作る（--quick で最短 1 本、省略時は規模を自動判定）
/2aio-check .                                   # 既存プロジェクトを評価 → 承認後に修正まで
```

### 4.（任意）常駐レイヤーを起動
```bash
node dashboard.mjs     # 2AIOForge ダッシュボード → http://localhost:7878
npm run control        # 制御プレーン（複数 repo 進行） → http://localhost:7900
```
詳細はそれぞれ Part 5 / Part 6 を参照。

---

## 🔄 更新方法

```bash
cd 2aio
git pull
./install.ps1 --update             # または bash install.sh --update
bash harness/install-harness.sh    # ハーネスを入れている場合（冪等・設定は保持）
```

| レイヤー | `--update` 時の挙動 |
|---|---|
| agents / commands / lanes | 常に最新へ上書き（repo から消えた旧 2aio-* コマンドは自動掃除） |
| skills | **2AIO が配備したものだけ**（`~/.claude/.2aio-manifest` 記載分）を上書き。ユーザー独自スキルには触らない |
| ハーネス | コード本体は更新、設定（security-rules.json / enforce-rules.json）はカスタマイズを保持 |

マニフェスト導入前（旧版）からのユーザーは、初回のみ `--adopt-all --update` を実行すると
同梱スキルがマニフェストに登録され、以後の更新が届くようになります。

## ⚙️ ライブハーネス（最重要 — Claude 司令塔 → Codex 実装）

2AIO は「入れるだけのファイル群」ではなく、**毎セッションを 2AIO の作法で走らせる稼働レイヤー**を持ちます。
中核思想は **賢いモデル（Claude）が司令塔＝計画・レビュー・統合・判断を持ち、大量のタイピング（実装）は
安いモデル/AI（Codex Terra/Luna ほか）に委譲する**こと。トークンを節約しつつ品質は賢いモデルが担保します。

| 部品 | 役割 |
|---|---|
| **guard**（Ring-1 PreToolUse） | 不可逆・漏洩アクションを実行前に遮断。全ツール呼び出しを監査ログ化 |
| **model / skill ルーティング** | タスクからモデル階層を動的選択（launch 時に実切替）＋ JP↔EN でスキルを確実に発火 |
| **Codex 委譲**（`codex-router/`） | `codex-run.sh` が安全に `codex exec` を実行。**brief 必須**（計画を保証）＋使用ログ |
| **enforcer**（`enforce/`） | Claude が大量の新規実装ファイルを直書きするのを**ハード遮断**し委譲を強制。司令塔役は温存（Edit/計画/レビューは常時許可） |
| **front-door**（`front-door/`） | 素のプロンプトから適切な 2AIO パイプライン（harden / board / redesign / research）へ誘導 |
| **providers**（`providers/`） | `ai-run.sh --provider <name>` で任意の OpenAI 互換 AI（openai / xai / deepseek / groq / ローカル ollama…）へ委譲。鍵は env のみ |

- **委譲の起動:** 内部レーン `2aio-delegate`（計画→brief→Codex→レビュー統合）。通常は enforcer / front-door が自動誘導するので意識不要。UI タスクは自動でデザイン品質 directive を付与。
- **クロスhost:** 操作モデルの正本は [`AGENTS.md`](./AGENTS.md)（Codex はネイティブに読む）。host 別導入は [`adapters/README.md`](./adapters/README.md)。
- 詳細と正直な限界（全操作の自動強制は hook を持つ Claude Code のみ完全）は [`harness/README.md`](./harness/README.md)。

---

## Part 1 — マルチエージェント（native）

### 使い方 — 入口は 2 モードだけ

**強い agent 集を意識しなくても使える**のが 2AIO のコンセプト。ユーザー向けコマンドは 2 つだけで、
規模判定・レーン選択・エージェント編成はすべて内部で自動化されます。

```bash
/2aio-create "沖縄観光 AI 案内チャットボット"   # ① 一から作る — 小規模なら即実装、大テーマなら取締役会→PRD→計画→実装まで自動
/2aio-check .                                   # ② 既存プロジェクトの評価 — 多観点監査→スコア付きレポート→承認後に修正まで
```

- `/2aio-create` は `--quick`（即実装を強制）/ `--full`（PRD からのフルコースを強制）で判定を上書き可。
- `/2aio-check` は `--report-only` で評価レポートのみ（コードに触らない）。

<details>
<summary>内部レーン一覧（上級者向け）</summary>

入口コマンド・制御プレーンが自動選択する内部レーン 10 本。`~/.claude/2aio/lanes/` に配備される。
直接使う場合は「`~/.claude/2aio/lanes/<name>.md` を Read し、引数を $ARGUMENTS としてその指示に従って」と指示する。

> `2aio-issue` / `2aio-harden` / `2aio-redesign` / `2aio-autorun-batch` / `2aio-delegate` の5本は
> **会話（Claude Code セッション）専用レーン**で、制御プレーン（headless）からは自動選択されない
> （`2aio-issue` は制御プレーンにも `kind: issue` があるが、決定表全体ではなく
> bug/feature報告→`2aio-dev`への縮退実装 — 会話側の完全な分類はこの5本には及ばない）。

| レーン | 役割 |
|---|---|
| `2aio-build` | 高速レーン: spec→実装→QA→公開を最短で |
| `2aio-start-project` | 取締役会（CEO/CMO/CTO）→ PRD |
| `2aio-plan-project` | PRD → 実装計画書（WBS） |
| `2aio-implement-project` | 実装 → QA → デプロイの自律実行 |
| `2aio-dev` | 既存 repo への 1 機能追加 / バグ修正 |
| `2aio-delegate` | 計画 → Codex 委譲 → レビュー統合 |
| `2aio-harden` | 既存システムを全次元で自律強化（loop-until-clean） |
| `2aio-redesign` | 既存 UI の作り直し専用 |
| `2aio-issue` | GitHub Issue を読んで適切なレーンへルーティング |
| `2aio-autorun-batch` | 複数テーマのバッチ実行 |

</details>

### エージェント（25 体）
**取締役会 + 計画・実装 9 体:** CEO(opus) / CMO / CTO / Planner / Architect / PRD / Engineer / QA / DevOps。
**リサーチ 8 体:** Researcher 統括 + 7 検索専門（Web・コード・ニュース・SNS・コミュニティ・Wikipedia・Gemini）。
**専門 8 体（description に「PROACTIVELY 使う」を持ち自動起動）:** frontend-engineer（UI 実装リード）/ design-reviewer / swift-reviewer / ios-debugger / observability / migration-runner / release-manager / project-auditor。
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

## Part 5 — 2AIOForge 自己強化ループ（ローカルLLM主体）

2AIO の設計知識・スキルを**常時自動で最新化**する。Web 検索で最新情報を集め、**ローカルLLM (Ollama)** が更新案を起草、監査役が検証。自動適用は「**vault × 低リスク × 監査PASS**」の全条件成立時のみで、それ以外（skills・高リスク・監査NG・`--dry`）はすべて提案（承認制）。

### パイプライン
```
収集(Web検索) → 合成(ローカルLLMが更新案を起草) → 監査 → 提案/適用 → 記録
```
- **ローカルLLM**: Ollama。モデルは `config.json` の `model`。URL は `OLLAMA_URL` 環境変数 > `config.json` の `ollamaUrl` > `http://localhost:11434` の順で決まる。
- **検索**: Tavily（`TAVILY_API_KEY` あれば優先）→ 無ければ DuckDuckGo（キーレス・フォールバック）。
- **監査**: `config.json` の `auditBackend` で切替（`claude` = ヘッドレス Claude 監査 / `local` = ローカルLLM多役クリティック）。NG なら指摘を反映して改稿（最大 `auditRounds` 回）。
- **適用方式（安全）** — 判定ロジックは `lib/policy.mjs` に一元化:
  - **自動適用 = vault × risk:low × 監査PASS のみ** → `vault/knowledge/auto/*.md` に書き込み（適用前バックアップ＋履歴記録、rollback 可）。
  - **それ以外はすべて提案** → `proposals/*.md`（＋機械可読な `.json` サイドカー）。人がダッシュボードで承認して反映する。

### 使い方
```bash
node run.mjs                    # 全トピック実行（Ollama 稼働が前提）
node run.mjs --topic=web-security   # 1 トピックだけ
node run.mjs --dry              # 適用せず提案だけ出す

node dashboard.mjs              # 監視・承認/却下・履歴 rollback → http://localhost:7878（ローカル限定バインド）
npm test                        # 安全分岐・承認反映の回帰テスト（node --test）
```
- 設定: `config.json`（model / auditBackend / topics / queries / target(vault|skill) / risk / auditRounds）。
- Tavily キー（任意・高品質検索）: `setx TAVILY_API_KEY "tvly-xxxxxxxx"`。未設定でも DuckDuckGo で動く。**service_role 等の強い鍵は置かない。**
- 常時化は OS のスケジューラ（Windows タスクスケジューラ / cron）で `node run.mjs` を定期実行。`auditBackend: "local"` にすれば Claude 不要・完全ローカルで回る。

### 設計上の安全
- skills/agents は**絶対に自動上書きしない**（提案→承認）。**監査NGも自動適用しない**。
- 承認による反映も `applyWithHistory()` 経由（適用前バックアップ・履歴記録・rollback 可）。書き込み先は config の vault/skills 配下のみ許可。
- すべての実行は `runs/` に記録され、安全分岐は `test/` の node:test で回帰検証される。

---

## Part 6 — 制御プレーン（複数 repo を 1 画面で進行）

**1 つのダッシュボードで複数 repo を進行**させ、**Claude サブスクの共有 5 時間ブロック**を食い潰さないよう、ジョブを予算ガバナーで直列/少数並列に消化する司令塔。設計の詳細は [docs/CONTROL-PLANE.md](./docs/CONTROL-PLANE.md)。

```bash
npm run control    # → http://localhost:7900（127.0.0.1 限定バインド）
```
- **リポジトリ登録（HTTPS）**: 画面から Git URL を登録すると `workspaces/` に clone。新規 repo は対話ヒアリング（`lib/intake.mjs`）→ 計画・実装ジョブを自動投入、既存 repo は解析ジョブでコード/docs/Issue を読み改善案を出力。
- **5 時間ブロックの使用状況**: `ccusage` から使用率・使用/上限トークン・reset 目安を常時表示。
- **ガバナー**（`lib/governor.mjs`）: 使用率が閾値（既定 80%）以上なら新規投入を停止 → reset 後に自動再開。同時実行は既定 1。
- **キュー**（`lib/queue.mjs`）: 投入ジョブを `control/queue.json` に永続化。`build`/`start`/`plan`/`implement`/`analyze` を各 repo へ委譲。
- 設定は `config.json` の `governor: { tokenThreshold, maxConcurrency, pollMs }`。`claude` バイナリは `CLAUDE_BIN` で指定可。

---

## 全体像・レジストリ
統合済み/カタログ済みの全ツール索引: [`catalog/tool-registry.md`](./catalog/tool-registry.md)。

## ライセンス
2AIO 本体: MIT。同梱スキル/参照ツールは各アップストリームのライセンス（大半 MIT、一部 Apache-2.0 / Elastic-2.0）に従い再配布。詳細は各 `SOURCE.md` と [`skills/SOURCES.md`](./skills/SOURCES.md)。
