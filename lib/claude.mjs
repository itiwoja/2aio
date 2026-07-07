// Claude Code をヘッドレス(claude -p)で呼ぶ監査バックエンド（APIキー不要・ログイン利用）
// --output-format json で使用量(usage)とコスト(total_cost_usd)も取得する
import { spawn } from 'node:child_process';
const CLAUDE = process.env.CLAUDE_BIN || 'C:\\Users\\1kkim\\.local\\bin\\claude.exe';

function runClaude(args, prompt, timeoutMs) {
  return new Promise((resolve, reject) => {
    let cp;
    try { cp = spawn(CLAUDE, args, { windowsHide: true }); }
    catch (e) { return reject(e); }
    let out = '', err = '';
    const t = setTimeout(() => { try { cp.kill(); } catch {} ; reject(new Error('claude timeout')); }, timeoutMs);
    cp.on('error', e => { clearTimeout(t); reject(e); });
    cp.stdout.on('data', d => out += d);
    cp.stderr.on('data', d => err += d);
    cp.on('close', c => { clearTimeout(t); c === 0 ? resolve(out) : reject(new Error('claude exit ' + c + ' ' + err.slice(0, 300))); });
    cp.stdin.write(prompt); cp.stdin.end();
  });
}

export async function claudeJSON(prompt, { timeoutMs = 120000, onUsage = null } = {}) {
  const raw = await runClaude(['-p', '--output-format', 'json'], prompt, timeoutMs);
  let env; try { env = JSON.parse(raw); } catch { env = { result: raw }; }
  if (onUsage && env.usage) onUsage({
    backend: 'claude', model: 'claude-code',
    inTok: env.usage.input_tokens || 0,
    cacheTok: (env.usage.cache_creation_input_tokens || 0) + (env.usage.cache_read_input_tokens || 0),
    outTok: env.usage.output_tokens || 0,
    costUsd: env.total_cost_usd ?? env.cost_usd ?? 0,
  });
  const text = env.result ?? raw;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  try { return JSON.parse(text); } catch { return null; }
}

export async function claudeReady() {
  try { const r = await runClaude(['-p'], 'OKとだけ返す', 60000); return /OK/i.test(r); } catch { return false; }
}
