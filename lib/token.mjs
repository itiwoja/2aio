// API トークン: control plane / dashboard の HTTP エンドポイントを保護する共有シークレット。
// 脅威モデルと効果（正確な記述 — 過大主張しない）:
//  - 防げる: ブラウザ経由のクロスオリジン攻撃（悪意サイトからの CSRF / 情報窃取）。Same-Origin Policy に
//    より攻撃サイトは `/`（トークン埋め込み）のレスポンス本文を読めないため、トークンを入手できない。
//    将来 LAN 公開する場合の未認証アクセスも防ぐ。
//  - 防げない（原理上）: 同一マシン・同一ユーザーで動く任意プロセス。トークン正本は <root>/control/.token に
//    平文で置かれ、同一 uid から読めるため、同一 uid のプロセスは常にトークンを入手できる（＝ファイルも
//    ソースも読める同一 uid はそもそも全権限を持つ）。この層はそこを守るものではない。
//  - トークンの配布: ブラウザには起動時にコンソールへ出す `?token=` 付き URL 経由でのみ渡す（Jupyter 方式）。
//    `/` も `/api/*` もトークン必須（未認証 GET / でのトークン漏洩口を塞ぐ）。
// 優先: 環境変数 AIO_API_TOKEN（非空）→ なければ <root>/control/.token を生成・再利用。
// control/ は .gitignore 済みなのでトークンはコミットされない。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function getApiToken(root) {
  const env = process.env.AIO_API_TOKEN;
  if (env) return env; // 明示指定（テスト・複数プロセス共有）を最優先
  const file = path.join(root, 'control', '.token');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch { /* 未生成 */ }
  const token = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, token, { mode: 0o600 });
  return token;
}

// 定数時間比較（タイミング攻撃対策）。長さ不一致・非文字列でも例外を投げず false を返す。
export function tokenEquals(a, expected) {
  if (typeof a !== 'string' || typeof expected !== 'string') return false;
  const ab = Buffer.from(a);
  const eb = Buffer.from(expected);
  if (ab.length !== eb.length) return false;
  return crypto.timingSafeEqual(ab, eb);
}
