# CCC: Claude Code Company + CCCForge 自己強化ループ

**CCC は会社のように動作するマルチエージェント・オーケストレーション・フレームワークです。** 取締役会（CEO・CMO・CTO・CSO・CFO）のように複数のエージェントが並列に意思決定し、PRD 生成・計画・実装・デプロイまで完全自動化します。

さらに **CCCForge**（自己強化ループ）を同梱。CCC の設計知識・スキルを Web 検索と**ローカルLLM (Ollama)** で常時自動更新し、監査役の検証を通ったものだけを安全に反映します。

## 構成

| 領域 | 内容 |
|------|------|
| `agents/` `commands/` | CCC マルチエージェント（役員17体 + ワークフローコマンド） |
| `run.mjs` `lib/` `config.json` | CCCForge 自己強化ループ（収集→合成→監査→適用/提案） |
| `dashboard.mjs` | 監視・手動実行・提案の承認/却下・履歴 rollback |
| `test/` | 安全分岐・承認反映の回帰テスト（`node --test`） |

---

## Part 1: CCC マルチエージェント・ワークフロー

### インストール

**Windows (PowerShell)**
```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/itiwoja/ccc/main/install.ps1" -OutFile "$env:TEMP/install.ps1"; & "$env:TEMP/install.ps1"
```

**macOS / Linux**
```bash
curl -fsSL https://raw.githubusercontent.com/itiwoja/ccc/main/install.sh | bash
```

### 使い方

```bash
# 新規テーマの検討（取締役会）
/ccc-start-project "沖縄観光 AI 案内チャットボット"

# テーマの実装計画
/ccc-plan-project {prd-file}

# 実装・デプロイ（自動化）
/ccc-implement-project {impl-plan-file}

# 超高速レーン（PRD不要）
/ccc-build {テーマ} --auto

# バッチ実行（複数テーマ一括）
/ccc-autorun-batch {テーマ1} {テーマ2} ...
```

### 役員エージェント（17体）

| 役職 | 職務 |
|------|------|
| CEO (opus) | 経営方針・最終判断 |
| CMO | 市場調査・競合分析 |
| CTO | 技術評価・スタック決定 |
| CSO | 戦略情報・トレンド分析 |
| CFO | 財務試算・ROI分析 |
| Planner | 実装計画・WBS分解 |
| Engineer | コード実装 |
| QA | テスト・品質検証 |
| DevOps | ビルド・デプロイ |
| Researcher + 6 search specialists | Web・ニュース・SNS・コミュニティ・Wikipedia・Gemini |

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

## ファイル
- `agents/` … CCC 役員エージェント定義（17体）
- `commands/` … CCC ワークフローコマンド（start-project / plan / implement / build / autorun-batch）
- `install.ps1` `install.sh` … CCC エージェント/コマンドのインストーラ
- `run.mjs` … CCCForge オーケストレータ（収集→合成→監査→適用/提案）
- `dashboard.mjs` … 監視・手動実行・提案の承認/却下・履歴rollback（http://localhost:7878）
- `lib/policy.mjs` … 自動適用可否の判定（安全設計の一元実装）
- `lib/proposals.mjs` … 提案の解決・承認反映・アーカイブ
- `lib/paths.mjs` … config パス解決・書き込み先の境界チェック
- `lib/ollama.mjs` … Ollama呼び出し（JSONモード）
- `lib/search.mjs` … Tavily / DuckDuckGo
- `lib/history.mjs` … バックアップ付き適用・履歴・rollback
- `config.json` … トピックと方針
- `test/` … 安全分岐・承認反映のテスト（`node --test`）
- `proposals/` `runs/` `history/` … 提案・実行ログ・変更履歴（git管理外）

## ライセンス

MIT
