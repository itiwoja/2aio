// Claude Code の実利用量を ccusage で取得（全セッション・5時間ブロック＝Max x5 の課金窓）
// 重い(npx数秒)ので 90秒キャッシュ
import { spawn } from 'node:child_process';
let cache = { t: 0, data: null };

function runCcusage(args, timeoutMs = 60000) {
  return new Promise((res) => {
    let cp;
    try { cp = spawn('npx', ['-y', 'ccusage@latest', ...args], { windowsHide: true, shell: true }); }
    catch { return res(null); }
    let out = '';
    const t = setTimeout(() => { try { cp.kill(); } catch {} ; res(null); }, timeoutMs);
    cp.stdout.on('data', d => out += d);
    cp.on('error', () => { clearTimeout(t); res(null); });
    cp.on('close', () => { clearTimeout(t); try { res(JSON.parse(out)); } catch { res(null); } });
  });
}

let inflight = null;

async function refresh() {
  const blocks = await runCcusage(['blocks', '--active', '--json']);
  let active = null;
  if (blocks && Array.isArray(blocks.blocks)) active = blocks.blocks.find(b => b.isActive) || blocks.blocks[0] || null;
  const data = {
    ok: !!blocks,
    active: active ? {
      tokens: active.totalTokens || 0,
      cost: active.costUSD || 0,
      start: active.startTime || null,
      end: active.endTime || null,
    } : null,
  };
  cache = { t: Date.now(), data };
  return data;
}

// 非ブロッキング (stale-while-revalidate): 手元のキャッシュを即返し、古ければ裏で更新する。
// ccusage は npx 経由で初回60秒近くかかるため、リクエスト処理内で await するとダッシュボード全体が固まる。
export function claudeUsage() {
  const stale = !cache.data || Date.now() - cache.t >= 90000;
  if (stale && !inflight) inflight = refresh().finally(() => { inflight = null; });
  return cache.data || { ok: false, pending: true, active: null };
}
