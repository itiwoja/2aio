// Claude Code の実利用量を ccusage で取得（全セッション・5時間ブロック＝Max x5 の課金窓）
// 重い(npx数秒)ので 90秒キャッシュ。診断用に生出力/stderr/例外を保持する。
import { spawn } from 'node:child_process';
let cache = { t: 0, data: null };
let diag = { ranAt: null, cmd: null, code: null, stderr: '', rawHead: '', parseOk: false, spawnErr: null, blocksLen: null, activePicked: false };

function runCcusage(args, timeoutMs = 60000) {
  return new Promise((res) => {
    const cmd = `npx -y ccusage@latest ${args.join(' ')}`;
    diag = { ranAt: new Date().toISOString(), cmd, code: null, stderr: '', rawHead: '', parseOk: false, spawnErr: null, blocksLen: null, activePicked: false };
    let cp;
    try { cp = spawn('npx', ['-y', 'ccusage@latest', ...args], { windowsHide: true, shell: true }); }
    catch (e) { diag.spawnErr = String(e.message); return res(null); }
    let out = '', err = '';
    const t = setTimeout(() => { try { cp.kill(); } catch {} ; diag.spawnErr = 'timeout'; res(null); }, timeoutMs);
    cp.stdout.on('data', d => out += d);
    cp.stderr.on('data', d => err += d);
    cp.on('error', (e) => { clearTimeout(t); diag.spawnErr = String(e.message); res(null); });
    cp.on('close', (code) => {
      clearTimeout(t);
      diag.code = code; diag.stderr = err.slice(0, 500); diag.rawHead = out.slice(0, 500);
      try { const j = JSON.parse(out); diag.parseOk = true; res(j); } catch { res(null); }
    });
  });
}

// ブロックのトークン数: totalTokens 優先、無ければ tokenCounts を合算(ccusageのバージョン差に耐える)。
function blockTokens(b) {
  if (typeof b.totalTokens === 'number') return b.totalTokens;
  const c = b.tokenCounts || b.tokens || {};
  return (c.inputTokens || 0) + (c.outputTokens || 0) + (c.cacheCreationInputTokens || 0) + (c.cacheReadInputTokens || 0);
}

let inflight = null;

async function refresh() {
  const blocks = await runCcusage(['blocks', '--active', '--json']);
  const arr = blocks && Array.isArray(blocks.blocks) ? blocks.blocks : null;
  diag.blocksLen = arr ? arr.length : null;
  // isActive 優先 → gapでない最初 → 先頭、の順で拾う(フィールド差・--active挙動差に耐える)
  let active = null;
  if (arr) active = arr.find(b => b.isActive) || arr.find(b => !b.isGap) || arr[0] || null;
  diag.activePicked = !!active;
  const data = {
    ok: !!blocks,
    active: active ? {
      tokens: blockTokens(active),
      cost: active.costUSD || active.cost || 0,
      start: active.startTime || active.start || null,
      end: active.endTime || active.end || null,
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

// 診断: 直近の ccusage 実行の生情報(コマンド/終了コード/stderr/生出力先頭/パース可否/ブロック数)。
export function ccusageDebug() { return { ...diag, cachedAt: cache.t ? new Date(cache.t).toISOString() : null, cached: cache.data }; }
