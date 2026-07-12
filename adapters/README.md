# 2AIO adapters — 各種 AI で使う

2AIO の**コアは host 非依存**（`harness/` 配下の router / guard / delegate wrapper / rules は
ただのスクリプト＋データ）。違いは「どの AI がそれを読み・呼び・どれだけ自動で強制するか」だけ。
操作モデルの正本は repo ルートの [`AGENTS.md`](../AGENTS.md)。

## host 別の入れ方

| host | 操作モデルの読ませ方 | 強制の強さ | インストール |
|---|---|---|---|
| **Claude Code** | `~/.claude/CLAUDE.md` + hooks（PreToolUse/UserPromptSubmit） | ✅ 強（guard/enforcer/advisor が自動発火） | `bash harness/install-harness.sh` |
| **Codex** | `AGENTS.md`（repo ルート & `~/.codex/AGENTS.md`）+ `~/.codex/config.toml`（approval/sandbox）+ notify hook | ⚠️ 中（常時指示＋sandbox。guard/router はスクリプトとして呼ぶ） | `cp AGENTS.md ~/.codex/AGENTS.md` |
| **Grok / その他 CLI** | その CLI が読む instructions ファイルに `AGENTS.md` を置く。無ければ API 委譲先として使う | ⚠️ CLI 次第（hook が無ければ指示ベースの弱い強制） | `harness/grok-router/grok-run.sh`（xAI API） |

## provider を跨ぐモデル自動切替

- **1セッション内の自動振り分け:** 駆動中の AI が、タスクごとに provider+モデルを選んで委譲する。
  基準は `AGENTS.md` の「Provider / モデル ルーティング」表と各 `routing-rules.json`。
  - 機械的→最安（Codex Luna / Claude Haiku）、通常→中位（Codex Terra / Claude Sonnet）、
    難→上位（Codex Sol / Claude Opus・必要時のみ）、最新情報/SNS→Grok。
- **委譲コマンド:** Codex=`harness/codex-router/codex-run.sh`、Grok=`harness/grok-router/grok-run.sh`。
  どちらも使用ログを `~/.claude/logs/2aio-usage.jsonl` に残す（誰にいつ何を投げたか監査可能）。

## 正直な限界

「全操作で自動発火する強制」は **hook を持つ host（Claude Code）でのみ完全**。Codex は sandbox+approval+
常時指示で"中"、hook の無い CLI は"指示ベース"。コア（安全ルール・ルーティング・委譲）は共通に使えるが、
**強制の自動性は host の機能に比例する**。
