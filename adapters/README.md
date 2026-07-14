# 2AIO adapters — 各種 AI で使う

2AIO の**コアは host 非依存**（`harness/` 配下の router / guard / delegate wrapper / rules は
ただのスクリプト＋データ）。違いは「どの AI がそれを読み・呼び・どれだけ自動で強制するか」だけ。
操作モデルの正本は repo ルートの [`AGENTS.md`](../AGENTS.md)。

## host 別の入れ方

| host | 操作モデルの読ませ方 | 強制の強さ | インストール |
|---|---|---|---|
| **Claude Code** | `~/.claude/CLAUDE.md` + hooks（PreToolUse/UserPromptSubmit） | ✅ 強（guard/enforcer/advisor が自動発火） | `bash harness/install-harness.sh` |
| **Codex** | `AGENTS.md`（repo ルート & `~/.codex/AGENTS.md`）+ `~/.codex/config.toml`（approval/sandbox）+ notify hook | ⚠️ 中（常時指示＋sandbox。guard/router はスクリプトとして呼ぶ） | `~/.codex` が存在すれば自動: `bash install.sh` / `./install.ps1` が `~/.codex/skills/`（entry skill `2aio-create`/`2aio-check` 含む全skill）を、`bash harness/install-harness.sh` が `~/.codex/AGENTS.md` を配備する。手動導入のみなら `cp AGENTS.md ~/.codex/AGENTS.md` |
| **その他 CLI（Grok 等）** | その CLI が読む instructions ファイルに `AGENTS.md` を置く。無ければ API 委譲先として使う | ⚠️ CLI 次第（hook が無ければ指示ベースの弱い強制） | `harness/providers/ai-run.sh --provider <name>`（OpenAI互換 API） |

Codex 側では `/skills` メニューまたは `$2aio-create` / `$2aio-check` で 2AIO の入口 2 個を明示呼び出しできる
（Claude Code の `/2aio-create` / `/2aio-check` と同じ内容。SKILL.md はホスト共通の Skill 標準なので
`skills/` の中身自体は Claude/Codex で書き換えていない）。

## provider を跨ぐモデル自動切替

- **1セッション内の自動振り分け:** 駆動中の AI が、タスクごとに provider+モデルを選んで委譲する。
  基準は `AGENTS.md` の「Provider / モデル ルーティング」表と各 `routing-rules.json`。
  - 機械的→最安（Codex Luna / Claude Haiku）、通常→中位（Codex Terra / Claude Sonnet）、
    難→上位（Codex Sol / Claude Opus・必要時のみ）、最新情報/SNS→Grok。
- **委譲コマンド:** Codex=`harness/codex-router/codex-run.sh`、その他=`harness/providers/ai-run.sh --provider <name>`（openai/xai/deepseek/ollama…）。
  どちらも使用ログを `~/.claude/logs/2aio-usage.jsonl` に残す（誰にいつ何を投げたか監査可能）。

## 正直な限界

「全操作で自動発火する強制」は **hook を持つ host（Claude Code）でのみ完全**。Codex は sandbox+approval+
常時指示で"中"、hook の無い CLI は"指示ベース"。コア（安全ルール・ルーティング・委譲）は共通に使えるが、
**強制の自動性は host の機能に比例する**。
