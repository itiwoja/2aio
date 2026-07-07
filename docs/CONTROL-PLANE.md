# CCC Control Plane — 設計ドキュメント

1つのダッシュボードで複数repoを進行させ、**Claudeサブスク（Max）の共有トークン枠**を食い潰さずに、各repoが**明示せずCCCを自動利用**する — その司令塔の設計。

## 背景と課題

CCC（マルチエージェント）と CCCForge（自己強化ループ）は統合済み（モノレポ）。既存の `dashboard.mjs` は**単一repoの監視**（run/approve/rollback）に閉じている。理想形は次の3つ:

1. **1画面で複数repoを進行**できる
2. Claudeは**サブスク（Max）のトークン**で動く（API従量ではない）
3. 全プロジェクトが**明示せず必要時にCCCを自動利用**する

## 中核の洞察: 共有サブスク枠が「キュー」を強制する

サブスクは **5時間ブロック＝有限の共有枠**（`config.claudeMax5x.tokenLimit`＝220Mtok, `costLimit:0`）。
API従量なら各repoを自由に並列できるが、**全repoが1つのMax枠を食い合う**ため無制限並列は即キャップ到達で全停止する。

→ 司令塔の本体は「監視」ではなく **トークン予算ガバナー＝ジョブキュー**。
そのセンサーは既に `lib/ccusage.mjs`（active block の `tokens / end`）として存在する。

## 3層アーキテクチャ

```
                 ┌──────────────────────────────────────────────┐
                 │   ccc-control（control.mjs / 1ホスト）        │
   ブラウザ ───► │  L3 制御: repos.json 登録簿 + queue + UI      │
   1画面で       │  L2 ガバナー: ccusage 5hブロックで入場判定     │
   複数repo進行  │  ワーカー: claude -p でCCCレーンを spawn       │
                 └────┬───────────────┬───────────────┬─────────┘
              spawn claude -p    spawn claude -p     …（直列 or 少数並列）
                   │                  │
            ┌──────▼─────┐     ┌──────▼─────┐
            │ repoA(git) │     │ repoB(git) │  ← L1: ~/.claude/skills の
            │ 明示せずCCC│     │ 明示せずCCC│     グローバルCCCを自動利用
            └────────────┘     └────────────┘
                  共有: Claude Max 5hブロック（220Mtok / costLimit:0）
```

### L1. アンビエントCCC層（明示せず自動で使う）— Phase 2
現状のエージェント description は意図的に封印（「CCC以外の一般依頼に使うな」）。全解除ではなく**入口だけ**自動起動可能にする。
- `~/.claude/skills/` に「新規プロダクト」「機能実装」「リサーチ」の3入口をSkill化（トリガー豊富な description → Claudeが自動ロード）。中身は既存 `/ccc-start-project`・`/ccc-build`・researcher へ委譲。
- `~/.claude/CLAUDE.md` に「タスク種別→CCCルーティング表」。＋ `UserPromptSubmit` フックで軽く誘導。
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
  - **existing（コード有り）**: `POST /api/analyze` で `analyze` ジョブ（README/docs/コード/Issueを読み、理解＋改善案＋CCC強化点を出力）。
- `lib/queue.mjs`: ジョブを `control/queue.json` に永続化（既存の runs/・history/ と同じ記録思想）。
- ワーカー: ガバナー許可がある限り `queued` を古い順に起動 → `spawn('claude', ['-p', prompt], { cwd: repo.path })`。
- API: `GET /api/control`／`POST /api/register`／`GET,POST /api/intake[/answer]`／`POST /api/analyze`／`POST /api/enqueue`／`POST /api/cancel`／`GET /api/debug`（ccusage生診断）。CSRF対策（Origin検査）は dashboard.mjs と同一。
- **対話ヒアリングの方式**: 「ダッシュボード上でAI対話」を採用。headless `claude -p` は非対話だが、UIが1ターンずつ回答を集め、各ターンで `claude -p` に次の質問を生成させることで**Webで完結する真の対話**を実現（サブスク枠を使用）。

## kind → プロンプト対応（control.mjs `buildPrompt`）
| kind | 実行プロンプト |
|------|--------------|
| `build` | `/ccc-build <theme> --auto` |
| `start` | `/ccc-start-project <theme>` |
| `plan` | `/ccc-plan-project <prd\|latest>` |
| `implement` | `/ccc-implement-project <plan\|latest> --auto` |

`prompt` を直接指定した場合はそれを優先。

## 設計テンション（意図的に残した判断）

1. **自動CCCの暴発リスク**: 完全アンビエント化は些細な依頼で重い取締役会を起動し共有枠を溶かす。→ **段階ルーティング必須**（`些末=直接実装 / 機能=ccc-build(lite) / 新規事業=取締役会フル`）。判定表はL1のCLAUDE.mdに置き、L2ガバナーが最終ゲート。
2. **並列 vs サブスク**: 真の同時並列は1サブスクでは物理的に困難。「複数repo進行」は**同時実行**でなく**1キューで滑らかに回す**（承認待ち時間に別repoを進める）と解釈。2アカウント以上あれば `CCC_CLAUDE_BIN`/プロファイルでワーカーを増やせる。
3. **LAN公開はしない（Phase 1）**: 書き込み（spawn）を伴うため 127.0.0.1 限定。複数ホストのforgeノード集約（プル型ハブ）とLAN公開＋トークン認証は Phase 3 で扱う。

## 段階導入

- **Phase 1 ✅（本コミット）**: ガバナー＋キューの制御プレーン（`control.mjs` / `lib/governor.mjs` / `lib/queue.mjs` / `repos.example.json` / テスト）。複数repoを1画面・1トークン枠で直列進行。
- **Phase 2**: アンビエントCCC（`~/.claude/skills/` 3入口＋グローバルCLAUDE.mdルーティング）。各repoで `/ccc-*` を打たずCCC始動。
- **Phase 3**: 自律ループ（reset後の自動消化・枠の厚い時間帯への重ジョブ自動投入／cron連携）＋複数ホスト集約（LAN・トークン認証）。

## 起動
```bash
cp repos.example.json repos.json   # 進行させたいrepoを登録
npm run control                    # → http://localhost:7900
npm test                           # governor/queue の回帰テスト
```
環境変数: `CCC_CONTROL_PORT`(既定7900) / `CCC_CLAUDE_BIN`(既定 claude) / `CCC_WORKER_CMD`(テスト用にworkerコマンドを差替)。
ガバナー設定は `config.json` の `governor: { tokenThreshold, maxConcurrency, pollMs }`。
