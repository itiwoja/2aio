// Claude Code の実利用量を ccusage で取得（全セッション・5時間ブロック＝Max x5 の課金窓）
// 重い(npx数秒)ので 90秒キャッシュ。診断用に生出力/stderr/例外を保持する。
import { spawn } from 'node:child_process';
// サプライチェーン対策: `@latest` の無人自動実行をやめ、既定は固定バージョンを実行する。
// 乗っ取られた新バージョンが無人でローカル実行される経路を塞ぐ。env で明示的に上書き可能。
const CCUSAGE_VERSION = process.env.AIO_CCUSAGE_VERSION || '20.0.17';
let cache = { t: 0, data: null };
let diag = { ranAt: null, cmd: null, code: null, stderr: '', rawHead: '', parseOk: false, spawnErr: null, blocksLen: null, activePicked: false };

export function buildCcusageCommand(version, args) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new TypeError('Invalid ccusage version');
  }
  if (!Array.isArray(args) || args.some(arg => !/^-{0,2}[A-Za-z0-9][A-Za-z0-9-]*$/.test(arg))) {
    throw new TypeError('Invalid ccusage argument');
  }
  return ['npx', '-y', `ccusage@${version}`, ...args].join(' ');
}

function runCcusage(args, timeoutMs = 60000) {
  return new Promise((res) => {
    let cmd;
    try { cmd = buildCcusageCommand(CCUSAGE_VERSION, args); }
    catch (e) {
      diag = { ranAt: new Date().toISOString(), cmd: null, code: null, stderr: '', rawHead: '', parseOk: false, spawnErr: String(e.message), blocksLen: null, activePicked: false };
      return res(null);
    }
    diag = { ranAt: new Date().toISOString(), cmd, code: null, stderr: '', rawHead: '', parseOk: false, spawnErr: null, blocksLen: null, activePicked: false };
    const isWindows = process.platform === 'win32';
    const executable = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npx';
    const spawnArgs = isWindows ? ['/d', '/s', '/c', cmd] : ['-y', `ccusage@${CCUSAGE_VERSION}`, ...args];
    let cp;
    try { cp = spawn(executable, spawnArgs, { windowsHide: true }); }
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
// 純関数として export — ここが壊れると tokens=0 が返りガバナーが「使用率0%」として
// 無制限 admit する（予算安全弁の静かな無効化。実事故 e7518b3）。test/ccusage.test.mjs で回帰固定。
export function blockTokens(b) {
  if (typeof b.totalTokens === 'number') return b.totalTokens;
  const c = b.tokenCounts || b.tokens || {};
  return (c.inputTokens || 0) + (c.outputTokens || 0) + (c.cacheCreationInputTokens || 0) + (c.cacheReadInputTokens || 0);
}

// active ブロックの選択: isActive 優先 → gap でない最初 → 先頭(フィールド差・--active挙動差に耐える)。
// 純関数として export。blocks が配列でなければ null（active=null → 予算で止めない、は
// governor 側で固定済みの意図的 fail-open — ccusage 不調でキューを恒久停止させないため）。
export function pickActiveBlock(arr) {
  if (!Array.isArray(arr)) return null;
  return arr.find(b => b && b.isActive) || arr.find(b => b && !b.isGap) || arr[0] || null;
}

let inflight = null;

async function refresh() {
  const blocks = await runCcusage(['blocks', '--active', '--json']);
  const arr = blocks && Array.isArray(blocks.blocks) ? blocks.blocks : null;
  diag.blocksLen = arr ? arr.length : null;
  const active = pickActiveBlock(arr);
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

// #20(5): run.mjs(バッチ実行)用のブロッキング取得。claudeUsage() は stale-while-revalidate で
// 初回 pending を返すため、監査バックエンドのガバナー連動判定にはこちらを使う。
// キャッシュが新しければ即返し、無ければ refresh を await する（最大 ~60秒）。
export async function claudeUsageBlocking() {
  if (cache.data && Date.now() - cache.t < 90000) return cache.data;
  if (!inflight) inflight = refresh().finally(() => { inflight = null; });
  return await inflight;
}
