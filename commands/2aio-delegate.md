---
description: Claude(Fable/Opus)が計画に専念し、実装を Codex(Terra/Luna) に委譲してトークンを節約する委譲レーン。計画→ブリーフ→Codex実装→Claudeレビュー統合。
argument-hint: <やりたいこと> [--write] [--parallel] [--model auto|luna|terra|sol] [--dir <repo>] [--auto]
---

**Claude が「考える」、Codex が「書く」。** 高価な Claude(Fable/Opus)トークンは *計画・レビュー・統合* に集中させ、機械的〜中難度の実装は安価な Codex(Terra/Luna) に流す委譲オーケストレーター。狙いは **同じ品質をより少ない Claude トークンで**。

**タスク:** $ARGUMENTS

## いつ使うか

- 仕様は自分(Claude)で固められるが、実装のタイピング量が多い
- 定型・雛形・一括変換・CRUD・テストスタブなど、深い判断より作業量が支配的
- ❌ 使わない: 一行で終わる修正 / アーキ根幹の判断そのもの / 深い設計対話（それは Claude 本体でやる）

## 絶対制約（安全線）

- **service_role 等の強権限トークンを Codex ブリーフにも会話にも絶対に書かない**（過去に PAT 流出の経緯あり）。秘密は環境変数参照名だけを渡す。
- Codex は `codex-run.sh` 経由でのみ起動する（インストール後は `~/.claude/codex-router/codex-run.sh`、リポジトリ内では `harness/codex-router/codex-run.sh`）。stdin閉じ・10MBログ上限・sandbox・構造化出力を強制。生 `codex exec` を直接叩かない。
- **Sol は既定で使わない。** router が「明示的に難しい」と判定した時だけ Sol。通常は Terra、機械的作業は Luna。
- 破壊的操作（大量削除 / force push / DB drop）は Codex に委譲しない。Claude が確認する。
- Codex の出力は **必ず Claude がレビューしてから統合**。無検証マージ禁止。

## フロー

### Phase 0 — 委譲判断（Claude/Fable）

まずこの委譲が妥当か判定する。次のいずれかなら Claude 本体で実装し、委譲しない:
- 差分が数行で済む / 委譲ブリーフを書く方が高くつく
- honesty-critical（セキュリティ判断・レビュー・語感/CJK の質判断）→ Claude に残す

委譲すると決めたら Phase 1 へ。

### Phase 1 — 徹底計画（Claude/Fable or Opus）

Claude が **実装せずに** 計画だけを固める。Codex が迷わず書ける粒度まで落とす:

1. **受け入れ条件** を測定可能な形で列挙（「動くか」ではなく「`X` が存在し `Y` を返す」）
2. **触るファイル / 触らないファイル** を明示（scope 分割）
3. **既存の規約**（命名・スタック・パターン）を1ブロックにまとめる
4. **段取り**（依存順・並列可否）

計画は `.ai/codex_brief_<slug>.md` に1回だけ書く（各タスクから参照＝トークン重複を避ける）。

### Phase 2 — 分岐: 単発 or 並列

| 条件 | 動き |
|---|---|
| サブタスク 1 個 | `codex-run.sh` を直接1回。`.coord` は作らない |
| **サブタスク ≥ 2 個（別Codex or 並列）** | **agent-task-splitter スキルを起動**して `.coord/plan.yml`（DAG）＋ `.ai/codex_task_*.md` を生成し、disjoint な files_in_scope で分割（F11 スコープ漏れ防止）。各タスクを並列 `codex-run.sh --bg` |

> 並列委譲は agent-task-splitter の規約に必ず従う。ブリーフを手書きで重複させない。

### Phase 3 — Codex 実装（Terra/Luna）

各サブタスクを wrapper 経由で起動。モデルは router が自動選択（`--model` で上書き可）:

```bash
# 単発・書き込みあり・バックグラウンド
bash ~/.claude/codex-router/codex-run.sh --write --bg \
  -C <repo> "<Phase1で固めた具体タスク（codex_brief を参照させる）>"

# 事前にモデルだけ確認したい
bash ~/.claude/codex-router/codex-run.sh --why "<task>"
```

- 既定 sandbox は read-only。ファイルを書かせる時だけ `--write`（workspace-write）。
- 実 work は遅いので `--bg` 推奨。結果は `.ai/codex_result_<ts>.jsonl`、ログは `.ai/codex_log_<ts>.txt`。
- 難タスクと分かっている時だけ `--model sol`。機械的と分かっていれば `--model luna` でrouter を待たず固定。

### Phase 4 — レビュー & 統合（Claude）

1. `codex_result_*.jsonl` と実際の diff を Claude が読む（`git diff`）。
2. 受け入れ条件（Phase 1）を1つずつ検証。未達なら **是正ブリーフを書いて Codex に差し戻す**（最大2往復）。
3. セキュリティ観点（秘密混入・入力検証・破壊的変更）を Claude が必ず自分でチェック。
4. 問題なければ統合。必要なら `code-reviewer` / `security-reviewer` エージェントを回す。
5. 並列委譲だった場合は reconcile（各タスクの成果を突き合わせ、スコープ重複や衝突を解消）。

## 出力

- `.ai/codex_brief_<slug>.md` — 計画正本
- `.coord/plan.yml` — 並列時のみ（DAG）
- `.ai/codex_result_<ts>.jsonl` / `.ai/codex_log_<ts>.txt` — Codex 実行記録（プロジェクト内）
- 統合済みの差分（Claude レビュー済み）

## ログ（後から「本当に使われたか」を検証できる）

委譲が実際に起きたことは、プロジェクト外の中央ログに追記される:

- **`~/.claude/logs/2aio-usage.jsonl`** — 委譲ごとに1〜2行。`codex_delegate_start`（Codex 起動**前**に記録＝途中で kill されても委譲した証拠が残る）＋ `codex_delegate_end`（model / tier / sandbox / dir / task / result / exit）。`AIO_USAGE_LOG` で変更可。
- **`~/.claude/.agent-audit/actions.jsonl`** — ハーネスのガードが全ツール呼び出しを記録（＝2AIO 自体が稼働していた証拠）。

確認: `tail -n 5 ~/.claude/logs/2aio-usage.jsonl`。ここに `tier` が terra/luna であれば「Sol を避けて委譲できた」ことも読み取れる。

## トークン節約の考え方

計画・レビューという *判断* だけを Claude が持ち、*タイピング* を Codex に出す。agent-task-splitter の実測では、手書きブリーフ比で並列委譲時に **約12〜14倍** のメイン session トークン削減。Sol を避けて Terra/Luna を既定にすることで Codex 側コストも最小化する。
