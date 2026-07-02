# CCC: Claude Code Company

**CCC は会社のように動作するマルチエージェント・オーケストレーション・フレームワークです。**

取締役会（CEO・CMO・CTO・CSO・CFO）のように複数のエージェントが並列に意思決定し、PRD 生成・計画・実装・デプロイまで完全自動化します。

## インストール

### Windows (PowerShell)
```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/itiwoja/ccc/main/install.ps1" -OutFile "$env:TEMP/install.ps1"; & "$env:TEMP/install.ps1"
```

### macOS / Linux
```bash
curl -fsSL https://raw.githubusercontent.com/itiwoja/ccc/main/install.sh | bash
```

## 使い方

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

## 役員エージェント（17体）

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

## ドキュメント

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 設計判断・原則・トラブルシューティング
- [README.md](./README.md) — このファイル

## ライセンス

MIT
