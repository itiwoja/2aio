---
description: 既存システムを 2AIO で「全面強化」する自律オーケストレーター。監査→観点別並列レビュー→CRITICAL/HIGHをCodex委譲で修正→再監査を、指摘が尽きるまでループする。機能は壊さない。/2aio-redesign の全方位版。
argument-hint: <対象dir|.> [--scope=<glob>] [--fix=CRITICAL|HIGH|MEDIUM] [--auto|--interactive] [--budget=<tokens>] [--rounds=N] [--no-loop]
---

> **表記の読み替え:** 本文中の `/2aio-<name>` は旧スラッシュコマンド表記。`~/.claude/2aio/lanes/2aio-<name>.md` を Read し、後続テキストを $ARGUMENTS としてその指示に従う意味に読み替える。

既存プロダクトを **一回指示で完了まで自律的に堅牢化** するオーケストレーター。`/2aio-redesign` が UI 専用なのに対し、本コマンドは **セキュリティ・品質・パフォーマンス・アクセシビリティ・可観測性・テスト・UIデザイン** を横断で監査し、重大な指摘を **Codex 委譲で修正 → 再監査** と回し、**指摘が尽きるまでループ**する。**機能を壊さない** が絶対原則。

**対象:** $ARGUMENTS

## 引数

| パターン | 意味 |
|---|---|
| `{対象dir}` | 強化するプロジェクトルート（省略時カレント `.`） |
| `--scope=` | 対象を絞る（例 `--scope=src/**`）。省略時は主要コードを自動選定 |
| `--dimensions=` | 監査する観点をカンマ指定で絞る（`security,code,a11y,perf,observability,tests,design,types`）。**省略時はプロジェクト種別から自動選定**（UI無しなら design/a11y を外す等）。全観点は重い |
| `--fix=` | 自動修正する下限重大度（既定 `HIGH` = CRITICAL+HIGH を修正。`MEDIUM` で MEDIUM まで） |
| `--auto` / `--interactive` | 既定 `interactive`。`--auto` は放置運転（ただし後述の絶対停止線では必ず止まる） |
| `--budget=` | 出力トークン上限。到達したら安全に中断してレポート |
| `--rounds=` | ループ最大周回数（既定 5）。安全弁 |
| `--no-loop` | 1周だけ（監査→修正→再監査）で終了 |

## 役割と絶対制約

- **機能を壊さない。** 各修正後に必ずビルド/テストが緑であることを確認。テストが無い領域は、修正前に `tdd-guide` で characterization テストを足してから触る（挙動固定 → 安全に改善）。
- **修正はスクラッチ書き直しをしない。** 既存スタックのまま狙い撃ちで直す。
- **秘密（service_role 等の強権限トークン）を brief にも会話にも出さない。** env 名のみ。
- **不可逆・外部作用は自動でやらない**（大量削除・force push・DB drop・デプロイ・公開）。`--auto` でも停止して承認を求める。
- 状態は `output/{project}/harden-state.md` を正本とし resume 可。

## 絶対停止線（モード問わず即停止）

- 機能破壊の検出（テスト赤が修正で戻らない）／秘密のコミット混入／不可逆操作の必要／予算到達／state.md I/O 障害。

## フロー

### Phase 0 — プリフライト（Claude）
- git repo か・作業ツリーがクリーンか確認（未コミット変更が多ければ先に退避を促す）。
- ベースライン記録: 現状のビルド/テスト/リンタ結果を `harden-state.md` に。強化前の緑/赤を把握。
- 対象・scope・`--fix` 下限・予算・周回上限を state に確定。

### Phase 1 — 監査（2aio-project-auditor）
- `2aio-project-auditor` で構成棚卸し（盲点・陳腐化・重複）。強化の当たりを付ける。

### Phase 2 — 観点別 並列レビュー（各担当agentを並列起動）

**コスト注意（実測）:** 1周で全観点（6〜9体）を回すと subagent 約 25〜30万トークン消費する。だから:
- `--dimensions` で観点を絞る（UI無しなら design/a11y を外す、セキュリティ監査なら security+code だけ 等）。省略時はプロジェクト種別から**自動で必要な観点だけ**選ぶ。
- `--budget` 未指定なら開始時に概算コストを提示し、`--auto` でなければ続行確認する。
- 各観点は**変更があった領域だけ**再監査する（Phase 4 で全再実行しない）。

重大度（CRITICAL/HIGH/MEDIUM/LOW）付きで指摘を集約する（対象は `--dimensions`）:

| 観点 | 担当agent |
|---|---|
| セキュリティ | `security-reviewer` |
| コード品質・重複・可読性 | `code-reviewer` + `code-simplifier` |
| 握りつぶし/エラー処理 | `silent-failure-hunter` |
| パフォーマンス | `performance-optimizer` |
| アクセシビリティ | `a11y-architect` |
| 可観測性（ログ/計装の欠落） | `2aio-observability` |
| テスト不足・カバレッジ | `tdd-guide` / `pr-test-analyzer` |
| UI/デザイン（UIがあれば） | `2aio-design-reviewer` |
| 型設計（該当言語） | 各言語 reviewer（typescript/python/go/rust/swift 等） |

集約は **重複排除 → 重大度順** に並べ、`harden-state.md` に findings 表として記録。

### Phase 3 — 修正（Codex 委譲・司令塔レビュー）
`--fix` 下限以上（既定 CRITICAL/HIGH）の各指摘を、2AIO 委譲フローで直す:
1. 修正計画を `.ai/codex_brief_<slug>.md` に書く（受け入れ条件＝「その指摘が解消される測定可能条件」＋エッジケース＋触らない範囲）。
2. `bash ~/.claude/codex-router/codex-run.sh --write -C <dir> "implement .ai/codex_brief_<slug>.md exactly"`（大きければ `--bg`）。
3. Claude が diff と受け入れ条件で検証 → **ビルド/テスト緑を確認**。緑にならなければ最大2回是正、それでもダメなら **その修正を revert して findings に「要手動」と記録**（機能破壊を残さない）。
4. セキュリティ観点（秘密混入・入力検証・破壊的変更）は Claude が必ず自分でチェック。

### Phase 4 — 再監査 & ループ判定
- 変更された領域を中心に Phase 2 を再実行。
- **新規 CRITICAL/HIGH が出れば Phase 3 へ戻る**。
- **2 周連続で新規 CRITICAL/HIGH がゼロ**になったら「クリーン」と判定して Phase 5 へ（loop-until-dry）。`--no-loop` は1周で終了。`--rounds`/`--budget` 到達でも安全終了。

### Phase 5 — クローズアウト（Claude）
- `MEDIUM/LOW` は直さず **バックログ一覧**として `harden-state.md` に残す（勝手に膨らませない）。
- サマリ: 直した CRITICAL/HIGH 件数、各観点のビフォー/アフター、テスト/ビルド状態、残課題。
- 変更は機能を壊していないこと（テスト緑）を最終確認。

## 「一回指示でずっと自律」にする使い方

本コマンドは**内部で指摘が尽きるまでループ**する。セッションをまたいで完了まで確実に走らせたいときは `/goal` と併用:

```
/2aio-harden C:\path\to\project --auto --budget=800000
/goal このリポの CRITICAL と HIGH がゼロになるまで /2aio-harden を自律継続。各修正後テスト緑を確認。予算 800k で安全停止。
```

`/goal` の Stop hook が「CRITICAL/HIGH ゼロ」まで停止をブロックするので、babysit 不要で完了まで自律的に回り、クリーンになったら自動で止まる。ガード＋delegation-enforcer が同時に効いているので、放置運転でも不可逆操作は起きない。

## 出力
- `output/{project}/harden-state.md` — 正本（findings 表・ラウンド記録・resume 用）
- `.ai/codex_brief_*.md` / `.ai/codex_result_*.jsonl` — 各修正の計画と実行記録
- 強化済みの差分（各修正はテスト緑を確認済み）＋ MEDIUM/LOW バックログ
