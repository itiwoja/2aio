# SECURITY

2AIO の脅威モデルと、防御が「境界」なのか「ヒューリスティック」なのかを正直に示す。
過大な安心を与えないことがこの文書の目的である（Hermes `SECURITY.md` の姿勢を参考にしている）。

## 1. 唯一の境界は OS / ホスト

敵対的に振る舞う LLM に対する**本当のセキュリティ境界は、実行しているホスト OS（およびサンドボックス／権限）だけ**である。
2AIO のリング型防御のうち、プロセス内で動くものは**境界ではなくヒューリスティック**であり、攻撃コストを上げるが、
十分に賢い・粘り強いモデルはいずれ回避しうる。次のものはヒューリスティックである:

- `harness/hooks/command-guard.py`（Ring-1 PreToolUse ガード）— 強力だがプロセス内フック。
- `harness/enforce/delegation-enforcer.py`（司令官が大量コードを直書きするのを止める）。
- `lib/redact.mjs`（秘密の墨消し）— 既知パターンのみ。未知の秘密形状は漏れうる。

これらに依存しきらず、本当に危険なワークロードは OS レベルの隔離（別ユーザー／コンテナ／VM）で動かすこと。

## 2. ホスト別の強制力（正直な表）

強制力は実行ホストのフック対応に依存して**劣化する**。詳細は [`AGENTS.md`](AGENTS.md) の
「ホスト別 enforcement」表を正本とする。要約:

| ホスト | 強制力 | 根拠 |
|--------|--------|------|
| Claude Code | 強 | PreToolUse フックが全ツール呼び出しを自動審査する |
| Codex | 中 | `AGENTS.md` の指示＋サンドボックス／承認に依存 |
| その他 CLI | 弱 | 指示ベースのみ（フックが無い） |

「Ring-1 が守るから安全」ではなく、「どのホストで動かすかによって守りの強さが変わる」と理解すること。

## 3. 秘密情報の扱い

- **原則: 秘密は環境変数“名”だけを扱い、値は briefs / チャット / ログ / 通知に出さない**（`ARCHITECTURE.md` #8）。
- **バックストップ: `lib/redact.mjs`** が、機外・UI・記録に出る面を送信前に墨消しする:
  - webhook 通知ペイロード・トースト（`lib/notify.mjs`）
  - 使用量記録 `usage.jsonl`（`lib/usage.mjs`）
  - `control/queue.json` に残るプロンプト・ログプレビュー・失敗理由（`control.mjs`）
- 墨消しは**既知の高確度パターンのみ**（ベンダ鍵接頭辞・JWT・Bearer/Authorization・秘密キーの key=value・PEM 秘密鍵・接続文字列のパスワード）。
  未知形状の秘密や、ワーカーの全文ログ `control/logs/*.ndjson`（ローカル専用・未墨消し）は対象外。ログを外部共有する際は自分で確認すること。
- **env スクラブ: worker 子プロセスへの秘密継承を止める**（`lib/redact.mjs` の `scrubEnv`、`control.mjs` の spawn）。
  control plane が持つ無関係な秘密（`LINEAR_API_KEY` 等）を worker（claude/codex）に渡さない。denylist 方式で
  非秘密（`PATH`/`HOME`/`USERPROFILE` 等）は素通しする。解決済み実行ファイルが Claude なら
  `ANTHROPIC_*`/`CLAUDE_*`、Codex なら `CODEX_API_KEY`/`CODEX_ACCESS_TOKEN` だけを既定で保持する。
  worker が別の秘密 env を必要とする場合（例: `gh` 用 `GITHUB_TOKEN`）は `config.json` の
  `worker.envKeep`（正規表現）で**追加**許可する。不正な型・正規表現は worker 起動前に fail closed となる。
- 露出した秘密は速やかにローテーションする。

## 4. 依存関係のポスチャ（なぜ自前の依存監査が無いか）

- **2AIO の Node サブシステム（`control.mjs` / `run.mjs` / `harness/*`）は npm ランタイム依存ゼロ**（Node 標準ライブラリのみ）。
  `package-lock.json` は存在せず、サプライチェーン攻撃面が構造的に最小化されている。したがって
  「自リポジトリの依存を OSV 監査する」対象は事実上無い。
- 外部を呼ぶ数少ない箇所は **`lib/ccusage.mjs` の `npx ccusage@<pinned>`**（バージョン固定）と、ワーカー／スキルが起動する各種ツールチェーン。
- **生成されたプロジェクトのコード**は別扱いで、`security/scanners/scan.sh`（gitleaks / SAST / IaC / サプライチェーン）を deploy ゲートで通す。
- 将来 2AIO 自体に npm 依存を足したら、この前提は崩れる。その時は依存監査（OSV 等）を導入すること。

## 5. ネットワークサーフェス

- `control.mjs`（:7900）と `dashboard.mjs`（:7878）は **`127.0.0.1` のみにバインド**し、共有トークン（`control/.token`、`lib/token.mjs`）で認証、CSRF もチェックする。
- これらを外部公開する設計変更を行う場合、認証・レート制限・オリジン検証を**必ず**追加すること（現状はローカル前提）。
- **webhook 送信の SSRF ガード**（`lib/notify.mjs`）: 通常の通知先は、userinfo/fragment のない public HTTPS のみ。
  全 A/AAAA 応答を一度だけ解決して検査し、global-unicast 以外が1件でもあれば拒否する。接続は検査済み IP に固定し、
  環境 proxy・既存 pooled socket・redirect を使わず、10秒で timeout する。
  自前ローカルリレーは、親プロセスの `AIO_LOCAL_WEBHOOK_URL` と完全一致する literal `127.0.0.1` / `::1` のみ opt-in で許可する。
  RFC1918/LAN や hostname ベースのローカル宛は許可しない。設定例と詳細は [`docs/WEBHOOK-SECURITY.md`](docs/WEBHOOK-SECURITY.md) を参照。

## 6. スコープ

**対象内**: 秘密の漏洩防止（原則＋墨消し）、破壊的 git 操作の自動実行拒否（`control.mjs` の dirty/非ff ガード）、
ローカル制御面の認証、生成コードの deploy 前スキャン、ホスト別強制力の明示。

**対象外（現状）**: プロセス内ガードだけで敵対的 LLM を完全封じ込めること、未知形状の秘密の完全検出、
外部ネットワーク公開時の防御、依存の実行時サンドボックス化。これらは OS/コンテナ隔離で補うこと。

## 7. 脆弱性の報告

セキュリティ上の問題を見つけたら、公開 issue ではなくリポジトリ所有者へ直接連絡すること。
