// 墨消しのテスト（Wave A）。秘密が確実に消えること・正当な出力が壊れないことの両方を固定する。
// 実行: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { redactSecrets, redactObject, isSensitiveKey, isSecretEnvKey, scrubEnv, MASK } from '../lib/redact.mjs';

test('Google API key fixture is not embedded as a contiguous source literal', () => {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{35}/);
});

const gone = (out, secret) => assert.ok(!out.includes(secret), `秘密が残っている: ${out}`);

test('ベンダのキー接頭辞を墨消しする', () => {
  const cases = [
    'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
    'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'github_pat_11ABCDEFG0abcdefghij_KLMNOPQRSTUVWXYZ0123456789abcdef',
    'xai-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'gsk_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'AKIAIOSFODNN7EXAMPLE',
    ['AI', 'za012345678901234567890123456789abcde'].join(''),
    'hf_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    'xoxb-' + '123456789012-ABCDEFGHIJKLMNOP',
  ];
  for (const secret of cases) {
    const out = redactSecrets(`key is ${secret} ok`);
    gone(out, secret);
    assert.ok(out.includes(MASK));
  }
});

test('JWT を墨消しする', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  gone(redactSecrets(`Authorization header: ${jwt}`), jwt);
});

test('Bearer / Authorization / x-api-key ヘッダの値を墨消しする', () => {
  gone(redactSecrets('Authorization: Bearer abcdef1234567890xyz'), 'abcdef1234567890xyz');
  gone(redactSecrets('x-api-key: 9f8e7d6c5b4a3210zzzz'), '9f8e7d6c5b4a3210zzzz');
});

test('key=value / key: value（秘密キー）を墨消しし、キー名は残す', () => {
  const a = redactSecrets('PASSWORD=hunter2secret');
  gone(a, 'hunter2secret');
  assert.ok(a.startsWith('PASSWORD='), `キー名が消えた: ${a}`);

  const b = redactSecrets('{ "api_key": "abcd1234efgh5678" }');
  gone(b, 'abcd1234efgh5678');
  assert.ok(b.includes('api_key'));

  gone(redactSecrets('client_secret = s3cr3t-value-here'), 's3cr3t-value-here');
});

test('--flag value（秘密フラグ）を墨消しする', () => {
  gone(redactSecrets('cmd --api-key abcd1234efgh5678 --verbose'), 'abcd1234efgh5678');
  gone(redactSecrets('cmd --token=abcd1234efgh5678'), 'abcd1234efgh5678');
});

test('PEM 秘密鍵ブロックを丸ごと墨消しする', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAsecretkeymaterial\n-----END RSA PRIVATE KEY-----';
  const out = redactSecrets(`config:\n${pem}\ndone`);
  gone(out, 'secretkeymaterial');
  assert.ok(out.includes('config:') && out.includes('done'));
});

test('接続文字列のパスワードだけ墨消しする', () => {
  const out = redactSecrets('postgres://user:p4ssw0rd@db.example.com:5432/app');
  gone(out, 'p4ssw0rd');
  assert.ok(out.includes('user') && out.includes('db.example.com'), `ホストやユーザーまで消えた: ${out}`);
});

// ── 誤爆ガード（正当な出力は壊さない） ──

test('通常文・パス・SHA・URL は変えない', () => {
  const keep = [
    'the token expired, please log in again',
    'model: sonnet',
    'C:\\Users\\test\\projects\\demo\\control.mjs',
    'commit a86bb73 docs: README を更新',
    'https://example.com/path?ref=main',
    'ジョブが done になりました（repo: myapp）',
  ];
  for (const s of keep) assert.equal(redactSecrets(s), s, `変わってはいけない: ${s}`);
});

test('トークン“数”のキー(tokensBefore/inTok/cacheTok)は秘密扱いしない', () => {
  for (const k of ['tokensBefore', 'tokensAfter', 'inTok', 'outTok', 'cacheTok', 'cacheRead', 'costUsd']) {
    assert.equal(isSensitiveKey(k), false, `数値カウントキーが秘密扱いされた: ${k}`);
  }
  for (const k of ['token', 'api_key', 'apiKey', 'password', 'client_secret', 'access_token', 'authorization']) {
    assert.equal(isSensitiveKey(k), true, `秘密キーが見逃された: ${k}`);
  }
});

test('redactObject: 秘密キーの値はマスク・カウントは温存・入れ子も辿る', () => {
  const input = {
    backend: 'claude', model: 'sonnet',
    inTok: 1200, outTok: 340, cacheTok: 50, tokensBefore: 88000000,
    api_key: 'sk-ant-shouldbe-masked-0123456789',
    nested: { authorization: 'Bearer zzzzzzzzzzzzzzzzzzzz', note: 'ran cmd --token=abcd1234efgh5678' },
  };
  const out = redactObject(input);
  assert.equal(out.inTok, 1200);
  assert.equal(out.tokensBefore, 88000000);
  assert.equal(out.model, 'sonnet');
  assert.equal(out.api_key, MASK);
  assert.equal(out.nested.authorization, MASK);
  gone(out.nested.note, 'abcd1234efgh5678');
  // 非破壊: 元オブジェクトは変わらない
  assert.equal(input.api_key, 'sk-ant-shouldbe-masked-0123456789');
});

test('非文字列はそのまま返す', () => {
  assert.equal(redactSecrets(42), 42);
  assert.equal(redactSecrets(null), null);
  assert.equal(redactSecrets(undefined), undefined);
});

// ── env スクラブ（worker への秘密継承を止める） ──

test('isSecretEnvKey: 秘密 env は true・OS/非秘密は false', () => {
  for (const k of ['LINEAR_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN', 'SLACK_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID', 'DB_PASSWORD', 'MY_APP_SECRET', 'GPG_KEY', 'OPENAI_API_KEY']) {
    assert.equal(isSecretEnvKey(k), true, `秘密 env が見逃された: ${k}`);
  }
  for (const k of ['PATH', 'HOME', 'USERPROFILE', 'TEMP', 'LANG', 'SSH_AUTH_SOCK', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'ANTHROPIC_BASE_URL']) {
    assert.equal(isSecretEnvKey(k), false, `非秘密 env が秘密扱いされた: ${k}`);
  }
});

test('scrubEnv: 無関係な秘密を落とし、非秘密と worker 認証は保持する', () => {
  const env = {
    PATH: '/usr/bin', HOME: '/home/test',
    LINEAR_API_KEY: 'lin_api_shouldbe_dropped',
    GITHUB_TOKEN: 'ghp_shouldbe_dropped',
    ANTHROPIC_API_KEY: 'sk-ant-keep-for-worker',       // keep で保持
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-keep-for-worker',  // keep で保持
  };
  const out = scrubEnv(env);
  assert.equal(out.PATH, '/usr/bin');
  assert.equal(out.HOME, '/home/test');
  assert.ok(!('LINEAR_API_KEY' in out), 'LINEAR_API_KEY が漏れている');
  assert.ok(!('GITHUB_TOKEN' in out), 'GITHUB_TOKEN が漏れている');
  assert.equal(out.ANTHROPIC_API_KEY, 'sk-ant-keep-for-worker');
  assert.equal(out.CLAUDE_CODE_OAUTH_TOKEN, 'oauth-keep-for-worker');
  // 非破壊
  assert.equal(env.LINEAR_API_KEY, 'lin_api_shouldbe_dropped');
});

test('scrubEnv: keep パターンを上書きすると対象秘密を残せる（gh 用 GITHUB_TOKEN 等）', () => {
  const env = { GITHUB_TOKEN: 'ghp_needed', LINEAR_API_KEY: 'lin_drop' };
  const out = scrubEnv(env, { keep: /^GITHUB_/i });
  assert.equal(out.GITHUB_TOKEN, 'ghp_needed');
  assert.ok(!('LINEAR_API_KEY' in out));
});

test('scrubEnv keeps selected worker auth and persisted login locations while dropping unrelated secrets', () => {
  const env = {
    PATH: '/usr/bin', HOME: '/home/test', USERPROFILE: 'C:\\Users\\test', CLAUDE_CONFIG_DIR: '/home/test/claude', CODEX_HOME: '/home/test/codex',
    ANTHROPIC_API_KEY: 'anthropic', CLAUDE_CODE_OAUTH_TOKEN: 'claude-oauth',
    CODEX_API_KEY: 'codex-key', CODEX_ACCESS_TOKEN: 'codex-token',
    GITHUB_TOKEN: 'github-token', OPENAI_API_KEY: 'cloud-token', DATABASE_URL: 'postgres://user:password@db/app',
    AWS_ACCESS_KEY_ID: 'aws-access', AWS_SECRET_ACCESS_KEY: 'aws-secret', AWS_SESSION_TOKEN: 'aws-session',
    GOOGLE_APPLICATION_CREDENTIALS: '/home/test/google-credentials.json',
    AZURE_CLIENT_SECRET: 'azure-secret', VAULT_TOKEN: 'vault-token',
    REDIS_URL: 'redis://:password@cache/0', PGPASSWORD: 'postgres-password', DOCKER_AUTH_CONFIG: '{"auths":{}}',
    HTTPS_PROXY: 'http://proxy-user:proxy-password@proxy.example:8080', HTTP_PROXY: 'http://proxy.example:8080',
    ALL_PROXY: 'proxy-user:proxy-password@proxy.example:8080',
    MONGODB_URI: 'mongodb://db-user:db-password@mongo.example/app',
    AMQP_URL: 'amqps://queue-user:queue-password@mq.example/vhost',
    SUPABASE_DB_URL: 'postgres://db-user:db-password@db.example/app',
  };

  const cloudKeep = '^(?:GITHUB_|OPENAI_|AWS_|GOOGLE_|AZURE_|VAULT_)';
  const claude = scrubEnv(env, { workerCommand: 'claude.exe', envKeep: cloudKeep });
  assert.equal(claude.ANTHROPIC_API_KEY, 'anthropic');
  assert.equal(claude.CLAUDE_CODE_OAUTH_TOKEN, 'claude-oauth');
  assert.equal(claude.CLAUDE_CONFIG_DIR, '/home/test/claude');
  assert.equal(claude.CODEX_HOME, '/home/test/codex');
  assert.equal(claude.USERPROFILE, 'C:\\Users\\test');
  assert.equal(claude.GITHUB_TOKEN, 'github-token');
  assert.equal(claude.OPENAI_API_KEY, 'cloud-token');
  assert.equal(claude.AWS_ACCESS_KEY_ID, 'aws-access');
  assert.equal(claude.AWS_SECRET_ACCESS_KEY, 'aws-secret');
  assert.equal(claude.GOOGLE_APPLICATION_CREDENTIALS, '/home/test/google-credentials.json');
  assert.equal(claude.AZURE_CLIENT_SECRET, 'azure-secret');
  assert.equal(claude.VAULT_TOKEN, 'vault-token');
  assert.ok(!('CODEX_API_KEY' in claude));
  assert.ok(!('DATABASE_URL' in claude));
  assert.ok(!('REDIS_URL' in claude));
  assert.ok(!('PGPASSWORD' in claude));
  assert.ok(!('DOCKER_AUTH_CONFIG' in claude));
  assert.ok(!('HTTPS_PROXY' in claude));
  assert.ok(!('ALL_PROXY' in claude));
  assert.ok(!('MONGODB_URI' in claude));
  assert.ok(!('AMQP_URL' in claude));
  assert.ok(!('SUPABASE_DB_URL' in claude));
  assert.equal(claude.HTTP_PROXY, 'http://proxy.example:8080');

  const codex = scrubEnv(env, { workerCommand: 'C:\\Program Files\\Codex\\codex.exe', envKeep: cloudKeep });
  assert.equal(codex.CODEX_API_KEY, 'codex-key');
  assert.equal(codex.CODEX_ACCESS_TOKEN, 'codex-token');
  assert.equal(codex.CODEX_HOME, '/home/test/codex');
  assert.equal(codex.CLAUDE_CONFIG_DIR, '/home/test/claude');
  assert.equal(codex.GITHUB_TOKEN, 'github-token');
  assert.equal(codex.OPENAI_API_KEY, 'cloud-token');
  assert.ok(!('ANTHROPIC_API_KEY' in codex));
  assert.ok(!('DATABASE_URL' in codex));
  assert.ok(!('MONGODB_URI' in codex));

  const custom = scrubEnv(env, { workerCommand: 'custom-worker', envKeep: cloudKeep });
  assert.equal(custom.GITHUB_TOKEN, 'github-token');
  assert.equal(custom.OPENAI_API_KEY, 'cloud-token');
  assert.equal(custom.AWS_SESSION_TOKEN, 'aws-session');
  assert.equal(custom.GOOGLE_APPLICATION_CREDENTIALS, '/home/test/google-credentials.json');
  assert.ok(!('ANTHROPIC_API_KEY' in custom));
  assert.ok(!('CODEX_API_KEY' in custom));
  assert.ok(!('MONGODB_URI' in custom));
  assert.ok(!('ALL_PROXY' in custom));
});

test('scrubEnv rejects malformed additive envKeep patterns instead of disabling scrubbing', () => {
  assert.throws(() => scrubEnv({ GITHUB_TOKEN: 'secret' }, { workerCommand: 'claude', envKeep: '[' }), /worker\.envKeep/);
  assert.throws(() => scrubEnv({ GITHUB_TOKEN: 'secret' }, { workerCommand: 'custom', envKeep: [] }), /worker\.envKeep/);
  assert.throws(() => scrubEnv({ GITHUB_TOKEN: 'secret' }, { workerCommand: 'custom', envKeep: {} }), /worker\.envKeep/);
  assert.throws(() => scrubEnv({ GITHUB_TOKEN: 'secret' }, { workerCommand: 'custom', envKeep: false }), /worker\.envKeep/);
  assert.throws(() => scrubEnv({ GITHUB_TOKEN: 'secret' }, { workerCommand: 'custom', envKeep: 0 }), /worker\.envKeep/);
});
