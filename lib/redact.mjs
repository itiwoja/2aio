// 秘密情報の墨消し（Wave A）。Hermes agent/redact.py の概念借用（MIT, Nous Research）。
// 目的: ログ・通知・使用量記録・完了レポート・UI プレビューに秘密が残らないバックストップ。
// 「秘密は env 名だけ、値は絶対に外へ出さない」(ARCHITECTURE.md #8) を機械的に担保する。
// 方針: 正当な出力を壊さないため、既知の高確度パターンのみを対象にする（bare 高エントロピー列は狙わない）。
// SOURCE: 発想は hermes-agent/agent/redact.py。コードは 2AIO 向けに新規実装（パターンは独自）。

export const MASK = '[REDACTED]';

// PEM 秘密鍵ブロック（最優先で丸ごと墨消し）。
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/g;

// JWT（header=eyJ で始まる 3 セグメント base64url）。プレフィクス要求で誤爆を抑制。
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;

// 既知ベンダのキー接頭辞（高確度）。長い順・具体的な順に並べる。
const VENDOR_TOKENS = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}/g,            // Anthropic
  /\bsk-proj-[A-Za-z0-9_-]{20,}/g,           // OpenAI project
  /\bsk-[A-Za-z0-9]{20,}/g,                  // OpenAI / 汎用 sk-
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,         // GitHub fine-grained PAT
  /\bgh[posru]_[A-Za-z0-9]{20,}/g,           // GitHub PAT/oauth/server/user/refresh
  /\bglpat-[A-Za-z0-9_-]{20,}/g,             // GitLab PAT
  /\bxai-[A-Za-z0-9]{20,}/g,                 // xAI
  /\bgsk_[A-Za-z0-9]{20,}/g,                 // Groq
  /\bAKIA[0-9A-Z]{16}\b/g,                   // AWS access key id
  /\bASIA[0-9A-Z]{16}\b/g,                   // AWS temp access key id
  /\bAIza[0-9A-Za-z_-]{35}\b/g,              // Google API key
  /\bya29\.[0-9A-Za-z_-]{20,}/g,             // Google OAuth token
  /\bhf_[A-Za-z0-9]{20,}/g,                  // HuggingFace
  /\bxox[baprs]-[0-9A-Za-z-]{10,}/g,         // Slack
  /\b(?:sk|pk)_live_[0-9A-Za-z]{20,}/g,      // Stripe live keys
  /\bSG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}/g, // SendGrid
  /\bnpm_[A-Za-z0-9]{36}\b/g,                // npm token
  /\bdop_v1_[a-f0-9]{64}\b/g,                // DigitalOcean
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,         // Telegram bot token
];

// 接続文字列のパスワード: scheme://user:pass@host → pass だけ墨消し。
const CONN_PW = /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)(@)/g;

// Bearer トークン。
const BEARER = /\b([Bb]earer\s+)[A-Za-z0-9._~+/=-]{10,}/g;

// Authorization 系ヘッダの値（KV では拾えない x-api-key 等）。
const AUTH_HEADER = /((?:authorization|proxy-authorization|x-api-key|x-auth-token)\s*[:=]\s*)(["']?)[^\s"',;]{4,}\2/gi;

// key=value / key: value（キー名が秘密っぽい時だけ値を墨消し。キー名と区切りは残す）。
const SENSITIVE_KEY_ALT = '(?:api[_-]?key|secret[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?key|secret|password|passwd|passphrase|pwd|token)';
const KV = new RegExp(`((?:^|[\\s,{"'])${SENSITIVE_KEY_ALT}["']?\\s*[:=]\\s*)(["']?)[^\\s"',;}]{1,200}(\\2)`, 'gi');

// --flag value / --flag=value（フラグ名が秘密っぽい時）。
const FLAG = new RegExp('(--?[a-z-]*(?:key|token|secret|password|pwd)[= ]\\s*)(["\']?)[^\\s"\']{4,200}(\\2)', 'gi');

/** 文字列中の秘密を墨消しする（非文字列はそのまま返す）。 */
export function redactSecrets(input) {
  if (typeof input !== 'string') return input;
  let s = input;
  s = s.replace(PRIVATE_KEY, '[REDACTED PRIVATE KEY]');
  s = s.replace(JWT, MASK);
  for (const re of VENDOR_TOKENS) s = s.replace(re, MASK);
  s = s.replace(CONN_PW, (_, pre, __, at) => pre + MASK + at);
  s = s.replace(BEARER, (_, pre) => pre + MASK);
  s = s.replace(AUTH_HEADER, (_, pre, q) => `${pre}${q}${MASK}${q}`);
  s = s.replace(KV, (_, pre, q) => `${pre}${q}${MASK}${q}`);
  s = s.replace(FLAG, (_, pre, q) => `${pre}${q}${MASK}${q}`);
  return s;
}

// キー名が「秘密の値を持つ」と判断されるか。数値カウントキー（tokensBefore/inTok/cacheTok 等）を
// 誤爆させないよう、境界を厳密にする（token は末尾に英字が続く語では一致させない）。
export function isSensitiveKey(k) {
  const key = String(k).toLowerCase();
  if (key === 'token' || key === 'key' || key === 'pwd' || key === 'secret') return true;
  if (/(^|[^a-z])(password|passwd|passphrase|apikey|credential|bearer|authorization)([^a-z]|$)/.test(key)) return true;
  if (/(^|[_-])(api[_-]?key|access[_-]?key|secret[_-]?key|private[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?secret)([_-]|$)/.test(key)) return true;
  return false;
}

/** オブジェクト/配列を深く辿り、秘密キーの値はマスク・文字列は redactSecrets を適用して新しい値を返す（非破壊）。 */
export function redactObject(value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSensitiveKey(k) && typeof v !== 'object' ? (v == null ? v : MASK) : redactObject(v);
    }
    return out;
  }
  return value;
}
