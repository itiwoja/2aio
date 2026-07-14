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

// env 変数名が秘密を持つか。env は SCREAMING_SNAKE 慣習で予測しやすいため、JSON 値向けの
// isSensitiveKey より広く取る（素の *_TOKEN / *_SECRET / *_KEY も拾う）。worker への継承可否判定用。
export function isSecretEnvKey(k) {
  const key = String(k).toUpperCase();
  if (['DATABASE_URL', 'REDIS_URL', 'PGPASSWORD', 'DOCKER_AUTH_CONFIG'].includes(key)) return true;
  if (/(^|_)(TOKEN|SECRET|SECRETS|PASSWORD|PASSWD|PASSPHRASE|PWD|APIKEY|CREDENTIAL|CREDENTIALS)(_|$)/.test(key)) return true;
  if (/_(API|ACCESS|PRIVATE|SECRET|SIGNING|ENCRYPTION|CLIENT|SESSION|REFRESH|AUTH)_?KEY(_|$)/.test(key)) return true;
  if (/_KEY$/.test(key) || key === 'KEY') return true;
  return false;
}

function hasUrlCredentials(value, allowSchemeless = false) {
  const raw = String(value).trim();
  const candidates = [raw];
  if (allowSchemeless && !raw.includes('://')) candidates.push(`http://${raw}`);
  return candidates.some((candidate) => {
    try {
      const url = new URL(candidate);
      return Boolean(url.username || url.password);
    } catch { return false; }
  });
}

function isCredentialedUrlValue(k, value) {
  return hasUrlCredentials(value)
    || (/(?:^|_)PROXY$/i.test(String(k)) && hasUrlCredentials(value, true));
}

// Selected-worker authentication baselines. Custom workers have no implicit secret access.
export const WORKER_ENV_KEEP = /^(?:ANTHROPIC_|CLAUDE_)/i;
export const CODEX_ENV_KEEP = /^(?:CODEX_API_KEY|CODEX_ACCESS_TOKEN)$/i;

function workerBaseline(workerCommand = 'claude') {
  const executable = String(workerCommand).trim().split(/[\\/]/).pop().toLowerCase();
  if (executable === 'claude' || executable === 'claude.exe') return WORKER_ENV_KEEP;
  if (executable === 'codex' || executable === 'codex.exe') return CODEX_ENV_KEEP;
  return null;
}

function compileEnvKeep(envKeep) {
  if (envKeep == null || envKeep === '') return null;
  if (envKeep instanceof RegExp) return envKeep;
  if (typeof envKeep !== 'string') throw new Error('Invalid worker.envKeep: expected a regular-expression string');
  try { return new RegExp(envKeep, 'i'); }
  catch (error) { throw new Error(`Invalid worker.envKeep regex: ${error.message}`); }
}

/**
 * Produce a non-mutating worker environment. Provider authentication is selected by the
 * resolved executable, while worker.envKeep is additive. Unknown workers receive no
 * implicit credentials, but all non-secret process settings (HOME, USERPROFILE, etc.) remain.
 */
export function scrubEnv(env = {}, { workerCommand = 'claude', envKeep, keep } = {}) {
  // keep is retained for callers from the original public helper API. New configuration uses
  // envKeep so it cannot accidentally replace the selected provider's baseline.
  const baseline = keep || workerBaseline(workerCommand);
  const additional = compileEnvKeep(envKeep);
  const matches = (pattern, key) => {
    if (!pattern) return false;
    pattern.lastIndex = 0;
    return pattern.test(key);
  };
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (matches(baseline, k) || matches(additional, k)) { out[k] = v; continue; }
    if (isSecretEnvKey(k) || isCredentialedUrlValue(k, v)) continue;
    out[k] = v;
  }
  return out;
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
