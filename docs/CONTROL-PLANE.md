# 2AIO Control Plane — 設計ドキュメント

1つのダッシュボードで複数repoを進行させ、**Claudeサブスク（Max）の共有トークン枠**を食い潰さずに、各repoが**明示せず2AIOを自動利用**する — その司令塔の設計。

## 背景と課題

2AIO（マルチエージェント）と 2AIOForge（自己強化ループ）は統合済み（モノレポ）。既存の `dashboard.mjs` は**単一repoの監視**（run/approve/rollback）に閉じている。理想形は次の3つ:

1. **1画面で複数repoを進行**できる
2. Claudeは**サブスク（Max）のトークン**で動く（API従量ではない）
3. 全プロジェクトが**明示せず必要時に2AIOを自動利用**する

## 中核の洞察: 共有サブスク枠が「キュー」を強制する

サブスクは **5時間ブロック＝有限の共有枠**（`config.claudeMax5x.tokenLimit`＝88Mtok, `costLimit:0`）。
API従量なら各repoを自由に並列できるが、**全repoが1つのMax枠を食い合う**ため無制限並列は即キャップ到達で全停止する。

→ 司令塔の本体は「監視」ではなく **トークン予算ガバナー＝ジョブキュー**。
そのセンサーは既に `lib/ccusage.mjs`（active block の `tokens / end`）として存在する。

## 3層アーキテクチャ

```
                 ┌──────────────────────────────────────────────┐
                 │   2aio-control（control.mjs / 1ホスト）        │
   ブラウザ ───► │  L3 制御: repos.json 登録簿 + queue + UI      │
   1画面で       │  L2 ガバナー: ccusage 5hブロックで入場判定     │
   複数repo進行  │  ワーカー: claude -p で2AIOレーンを spawn       │
                 └────┬───────────────┬───────────────┬─────────┘
              spawn claude -p    spawn claude -p     …（直列 or 少数並列）
                   │                  │
            ┌──────▼─────┐     ┌──────▼─────┐
            │ repoA(git) │     │ repoB(git) │  ← L1: ~/.claude/skills の
            │ 明示せず2AIO│     │ 明示せず2AIO│     グローバル2AIOを自動利用
            └────────────┘     └────────────┘
                  共有: Claude Max 5hブロック（88Mtok / costLimit:0）
```

### L1. アンビエント2AIO層（明示せず自動で使う）— Phase 2
現状のエージェント description は意図的に封印（「2AIO以外の一般依頼に使うな」）。全解除ではなく**入口だけ**自動起動可能にする。
- `~/.claude/skills/` に「新規プロダクト」「機能実装」「リサーチ」の3入口をSkill化（トリガー豊富な description → Claudeが自動ロード）。中身は既存 `/2aio-start-project`・`/2aio-build`・researcher へ委譲。
- `~/.claude/CLAUDE.md` に「タスク種別→2AIOルーティング表」。＋ `UserPromptSubmit` フックで軽く誘導。
- 既存 agents/commands はSkillから呼ばれる実体として温存。

### L2. トークン予算ガバナー層（サブスクを食い潰さない）— Phase 1 ✅
司令塔の心臓部。`lib/governor.mjs`（純ロジック）が入場判定を一元化する。
- 判定順: **同時実行上限 → 予算閾値 → 許可**。
- `active.tokens / tokenLimit >= threshold`（既定0.8）で新規投入を停止し、`active.end`（reset時刻）まで自動待機、リセット後に自動再開。
- ccusage未取得（`active=null`）や `tokenLimit` 不明時は**予算では止めない**（同時実行のみで判定）フェイルオープン。
- 既定は `maxConcurrency:1`（サブスク枠＋レート制限を共有するため直列運用が安全）。

### L3. マルチrepo制御層（1画面で複数repo進行）— Phase 1 ✅
`control.mjs`（依存ゼロ・127.0.0.1バインド・`node --test`）。
- **リポジトリ登録は HTTPS URL**（`POST /api/register?url=`）: `lib/repo.mjs` の `parseRepoUrl` で解析 → `workspaces/<name>` に `git clone` → `classifyRepo` で **new/existing 判定**。`repos.json`（git管理外）が正本レジストリ。
  - **new（コード無し）**: `control/intake/<id>.json` に対話を用意（seed質問）。`POST /api/intake/answer` で Claude(サブスク)が次の1問 or 完了(brief) を返す（`lib/intake.mjs`）。完了で `implement` ジョブを自動投入。
  - **existing（コード有り）**: `POST /api/analyze` で `analyze` ジョブ（README/docs/コード/Issueを読み、理解＋改善案＋2AIO強化点を出力）。
- `lib/queue.mjs`: ジョブを `control/queue.json` に永続化（既存の runs/・history/ と同じ記録思想）。
- ジョブ全文ログ (#14): `control/logs/<jobId>.ndjson`（stream-json イベント追記。queue.json の log[] は最新20行プレビューのみ）。**`control/logs/` はルートの `history/`（2AIOForge の vault 変更履歴）とは別物。**
- ワーカー: ガバナー許可がある限り `queued` を古い順に起動 → `spawn(claudeBin, ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', permissionMode, '--allowedTools', allowedTools, ...(model ? ['--model', model] : [])], { cwd: repo.path })`（`buildWorkerArgs()` が正本。既定 `permissionMode: 'acceptEdits'` / `model: 'sonnet'` 固定、`allowedTools` 既定値と個別上書きは `config.json` の `worker` を正本参照 — 転記しない）。終了時に result イベントから usage / total_cost_usd / 失敗理由を抽出し、成果物リンクは `output/*/state.md`（正本）から拾う。
- API: `GET /api/control`／`GET /api/job?id=`（詳細+ログ末尾）／`POST /api/register`／`GET,POST /api/intake[/answer]`／`POST /api/analyze`／`POST /api/enqueue`／`POST /api/cancel`（実行中はツリーkill）／`GET /api/debug`（ccusage生診断）。CSRF対策（Origin検査）は dashboard.mjs と同一。**全 `/api/*` は `x-2aio-token` ヘッダ必須（同一マシンのローカルトークン認証。未認証401 — 既に実装済み、Phase 1 から必須。下記「Phase 3」は LAN/リモート向けのネットワーク認証であり、このローカルトークンとは別物）。**
- テスト/カバレッジ (#22): CI ゲートは「テスト全パス」必須。カバレッジ 80% 閾値はテスト済みコアモジュール（governor/queue/policy/proposals/intake/repo）に限定して適用。外部プロセスラッパー（claude/ccusage/search/ollama/usage/history）は当面除外 — **lib 全体 80% は将来目標**（Node のカバレッジはロードされたファイルのみ報告するため、真に課すとモック大量作成でスコープが膨張する）。
- **対話ヒアリングの方式**: 「ダッシュボード上でAI対話」を採用。headless `claude -p` は非対話だが、UIが1ターンずつ回答を集め、各ターンで `claude -p` に次の質問を生成させることで**Webで完結する真の対話**を実現（サブスク枠を使用）。

## kind → 委譲先レーン/コマンド（control.mjs `buildPrompt`）
| kind | 実行方法 |
|------|--------------|
| `build` | `2aio-build` レーンへ委譲 |
| `start` | `2aio-start-project` レーンへ委譲 |
| `plan` | `2aio-plan-project` レーンへ委譲（`<prd\|latest>`） |
| `implement` | `2aio-implement-project` レーンへ委譲（`<plan\|latest> --auto`） |
| `analyze` | 既存repo解析（README/docs/コード/Issueを読み理解＋改善案＋2AIO強化点を出力、CLAUDE.md反映） |
| `feature` / `fix` / `issue` | `2aio-dev` レーンへ委譲（機能追加／バグ修正／Issue起点） |
| `test` | テストコマンドを検出して全実行、失敗は最大3往復で自己修正 |
| `review` / `refactor` | `/code-review <target>` ／ `/refactor-clean <target>`（実スラッシュコマンドをそのまま emit — 下記レーン委譲とは異なりレーン化しない） |
| `idd-intent` / `idd-plan` / `idd-mvp` | IDD ブリッジ（intent→plan→mvp で停止）。`idd-intent` は `/idd-intent <theme>` を実スラッシュコマンドとして emit |
| `pr` | 秘密スキャン後に push → `gh pr create` |

「レーンへ委譲」の実体は `laneInvocation()`（`lib/intake.mjs` が単一正本）: レーンファイルの絶対パス（`~/.claude/2aio/lanes/<name>.md`）を埋め込み、「Read し、その指示に $ARGUMENTS を『...』として厳密に従って実行してください」という指示文を生成する。旧スラッシュコマンド（`/2aio-build` 等）をそのまま emit するわけではない — `review`/`refactor`/`idd-intent` の実スラッシュ emit とは異なる契約（#58）。

`prompt` を直接指定した場合はそれを優先。

## 設計テンション（意図的に残した判断）

1. **自動2AIOの暴発リスク**: 完全アンビエント化は些細な依頼で重い取締役会を起動し共有枠を溶かす。→ **段階ルーティング必須**（`些末=直接実装 / 機能=2aio-build(lite) / 新規事業=取締役会フル`）。判定表はL1のCLAUDE.mdに置き、L2ガバナーが最終ゲート。
2. **並列 vs サブスク**: 真の同時並列は1サブスクでは物理的に困難。「複数repo進行」は**同時実行**でなく**1キューで滑らかに回す**（承認待ち時間に別repoを進める）と解釈。2アカウント以上あれば `AIO_CLAUDE_BIN`/プロファイルでワーカーを増やせる。
3. **LAN公開はしない（Phase 1）**: 書き込み（spawn）を伴うため 127.0.0.1 限定。同一マシンのローカルトークン認証（`x-2aio-token`）は既に必須実装済み — ここでいう Phase 3 の「LAN公開＋トークン認証」は**LAN/リモート向けのネットワーク認証**（別物）で、複数ホストのforgeノード集約（プル型ハブ）と併せて Phase 3 で扱う。

## 段階導入

- **Phase 1 ✅（本コミット）**: ガバナー＋キューの制御プレーン（`control.mjs` / `lib/governor.mjs` / `lib/queue.mjs` / `repos.example.json` / テスト）。複数repoを1画面・1トークン枠で直列進行。
- **Phase 2**: アンビエント2AIO（`~/.claude/skills/` 3入口＋グローバルCLAUDE.mdルーティング）。各repoで `/2aio-*` を打たず2AIO始動。
- **Phase 3**: 自律ループ（reset後の自動消化・枠の厚い時間帯への重ジョブ自動投入／cron連携）＋複数ホスト集約（LAN・**LAN/リモート向けのネットワーク認証** — 同一マシンのローカルトークン認証はPhase 1から既に必須）。

## 起動
```bash
cp repos.example.json repos.json   # 進行させたいrepoを登録
npm run control                    # → http://localhost:7900
npm test                           # governor/queue の回帰テスト
```
環境変数: `AIO_CONTROL_PORT`(既定7900) / `AIO_CLAUDE_BIN`(既定 claude) / `AIO_WORKER_CMD`(テスト用にworkerコマンドを差替)。
ガバナー設定は `config.json` の `governor: { tokenThreshold, maxConcurrency, pollMs }`。
