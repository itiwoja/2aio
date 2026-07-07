#!/usr/bin/env node
// CCC Control Plane — 1画面で複数repoを進行させる司令塔(Phase 1: ガバナー＋キュー)
// 依存ゼロ。 node control.mjs → http://localhost:7900
// 設計: docs/CONTROL-PLANE.md
//  - サブスク(Claude Max)の共有5時間ブロックを ccusage で監視し、枠が薄ければジョブ投入を止める。
//  - repos.json に登録したrepoへ claude -p でCCCレーンを spawn。基本は直列(サブスク枠共有のため)。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { claudeUsage } from './lib/ccusage.mjs';
import { admitJob } from './lib/governor.mjs';
import { loadQueue, enqueue, updateJob, nextQueued, countRunning, cancel } from './lib/queue.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const GOV = { tokenThreshold: 0.8, maxConcurrency: 1, pollMs: 5000, ...(CFG.governor || {}) };
const TOKEN_LIMIT = CFG.claudeMax5x?.tokenLimit || 0;
const PORT = process.env.CCC_CONTROL_PORT || 7900;
const CLAUDE = process.env.CCC_CLAUDE_BIN || process.env.CLAUDE_BIN || 'claude';
// テスト/ドライラン用に worker コマンドを丸ごと差し替え可能(既定は claude -p)
const WORKER_CMD = process.env.CCC_WORKER_CMD || '';

const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// 登録簿: repos.json > repos.example.json(サンプル)。未登録なら空。
function loadRepos() {
  const j = readJSON(path.join(ROOT, 'repos.json')) || readJSON(path.join(ROOT, 'repos.example.json'));
  const repos = (j && Array.isArray(j.repos)) ? j.repos : [];
  return repos.filter(r => r && r.id && r.path);
}
const repoById = (id) => loadRepos().find(r => r.id === id) || null;

// kind → 実行プロンプト(CCCの入口レーンへ委譲)。prompt指定があればそれを優先。
function buildPrompt(job) {
  if (job.prompt) return job.prompt;
  const a = job.args || {};
  switch (job.kind) {
    case 'build': return `/ccc-build ${a.theme || ''} ${a.flags || '--auto'}`.trim();
    case 'start': return `/ccc-start-project ${a.theme || ''}`.trim();
    case 'plan': return `/ccc-plan-project ${a.prd || 'latest'}`.trim();
    case 'implement': return `/ccc-implement-project ${a.plan || 'latest'} ${a.flags || '--auto'}`.trim();
    default: return (a.theme || a.text || '').trim();
  }
}

// ガバナー入力を現在状態から組む
function governorState() {
  const usage = claudeUsage(); // stale-while-revalidate: 即返る
  const active = usage?.active || null;
  const running = countRunning(ROOT);
  const decision = admitJob({ active, tokenLimit: TOKEN_LIMIT, threshold: GOV.tokenThreshold, running, maxConcurrency: GOV.maxConcurrency });
  return { usage, active, running, decision };
}

// ─── ワーカー: ガバナー許可がある限り queued を起動する ───
const procs = new Map(); // jobId → child

function startJob(job) {
  const repo = repoById(job.repo);
  if (!repo) { updateJob(ROOT, job.id, { state: 'failed', endedAt: new Date().toISOString(), log: [`repo未登録: ${job.repo}`] }); return; }
  const prompt = buildPrompt(job);
  const { active } = governorState();
  updateJob(ROOT, job.id, { state: 'running', startedAt: new Date().toISOString(), tokensBefore: active?.tokens ?? null, resolvedPrompt: prompt });

  let cmd, args;
  if (WORKER_CMD) { const parts = WORKER_CMD.split(' '); cmd = parts[0]; args = [...parts.slice(1), prompt]; }
  else { cmd = CLAUDE; args = ['-p', prompt]; }

  let child;
  try { child = spawn(cmd, args, { cwd: repo.path, windowsHide: true }); }
  catch (e) { updateJob(ROOT, job.id, { state: 'failed', endedAt: new Date().toISOString(), exit: -1, log: [String(e.message)] }); return; }
  procs.set(job.id, child);

  const push = (b) => {
    const j = loadQueue(ROOT).find(x => x.id === job.id); if (!j) return;
    String(b).split('\n').filter(Boolean).forEach(l => { j.log.push(l); while (j.log.length > 200) j.log.shift(); });
    updateJob(ROOT, job.id, { log: j.log });
  };
  child.stdout.on('data', push); child.stderr.on('data', push);
  child.on('error', (e) => push('[spawn error] ' + e.message));
  child.on('close', (code) => {
    procs.delete(job.id);
    const { active: after } = governorState();
    updateJob(ROOT, job.id, {
      state: code === 0 ? 'done' : 'failed', exit: code,
      endedAt: new Date().toISOString(), tokensAfter: after?.tokens ?? null,
    });
    tick(); // 1つ空いたので次を検討
  });
}

let ticking = false;
function tick() {
  if (ticking) return; ticking = true;
  try {
    // 許可が出る限り queued を起動(maxConcurrencyまで)
    for (;;) {
      const { decision } = governorState();
      if (!decision.admit) break;
      const job = nextQueued(ROOT);
      if (!job) break;
      startJob(job);
    }
  } finally { ticking = false; }
}

// ─── HTTP ───
const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
function csrfBlocked(req) {
  if (req.method !== 'POST') return false;
  const origin = req.headers.origin;
  if (!origin) return false;
  return !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function overview() {
  const g = governorState();
  const jobs = loadQueue(ROOT).slice(0, 100);
  const by = (s) => jobs.filter(j => j.state === s).length;
  return {
    governor: {
      ...g.decision,
      tokenLimit: TOKEN_LIMIT,
      usedTokens: g.active?.tokens ?? null,
      resetAt: g.active?.end ?? null,
      usageOk: !!g.usage?.ok, usagePending: !!g.usage?.pending,
      maxConcurrency: GOV.maxConcurrency, threshold: GOV.tokenThreshold,
    },
    repos: loadRepos().map(r => ({ id: r.id, path: r.path, branch: r.branch || '', lane: r.defaultLane || 'build' })),
    stats: { queued: by('queued'), running: by('running'), done: by('done'), failed: by('failed') },
    jobs,
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (csrfBlocked(req)) return send(res, 403, 'application/json', JSON.stringify({ ok: false, err: 'cross-origin POST拒否' }));
  if (u.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', HTML);
  if (u.pathname === '/api/control') return send(res, 200, 'application/json', JSON.stringify(overview()));
  if (u.pathname === '/api/enqueue' && req.method === 'POST') {
    const repo = u.searchParams.get('repo') || '';
    const kind = u.searchParams.get('kind') || 'build';
    const theme = u.searchParams.get('theme') || '';
    const prompt = u.searchParams.get('prompt') || '';
    if (!repoById(repo)) return send(res, 422, 'application/json', JSON.stringify({ ok: false, err: 'repo未登録' }));
    const job = enqueue(ROOT, { repo, kind, args: { theme }, prompt });
    tick();
    return send(res, 200, 'application/json', JSON.stringify({ ok: true, job }));
  }
  if (u.pathname === '/api/cancel' && req.method === 'POST') {
    const r = cancel(ROOT, u.searchParams.get('id') || '');
    return send(res, r.ok ? 200 : 422, 'application/json', JSON.stringify(r));
  }
  send(res, 404, 'text/plain', 'not found');
});
// 書き込み(spawn)を伴うためローカル限定バインド。LAN公開は Phase 3(トークン認証)まで行わない。
server.listen(PORT, '127.0.0.1', () => console.log(`[ccc-control] http://localhost:${PORT}`));
claudeUsage(); // ccusage プリウォーム
setInterval(tick, GOV.pollMs); // reset後などに自動で消化再開

const HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CCC Control</title><style>
:root{--bg:#0f1216;--panel:#161b22;--panel2:#1c232c;--line:#2a323d;--ink:#e6edf3;--sub:#9aa7b4;--accent:#5db0ff;--ok:#3fb950;--warn:#d2a23a;--bad:#f0626f;--mono:"Cascadia Code",ui-monospace,Consolas,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:"Segoe UI",system-ui,sans-serif;line-height:1.5}
header{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(15,18,22,.94);backdrop-filter:blur(8px);z-index:5}
h1{font-size:17px;margin:0}h1 b{color:var(--accent)}.spacer{flex:1}.muted{color:var(--sub);font-size:12px}
main{padding:20px 22px;max-width:1100px;margin:0 auto;display:grid;gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.card h2{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--sub);margin:0 0 12px;font-weight:600}
.grid{display:grid;gap:14px}.g4{grid-template-columns:repeat(4,1fr)}@media(max-width:720px){.g4{grid-template-columns:repeat(2,1fr)}}
.kpi{font-size:28px;font-weight:700;font-family:var(--mono)}.kpi small{display:block;font-size:12px;color:var(--sub);font-weight:400;margin-top:2px}
.kpi.ok{color:var(--ok)}.kpi.warn{color:var(--warn)}.kpi.bad{color:var(--bad)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}th{color:var(--sub);font-size:11px;text-transform:uppercase}
.mono{font-family:var(--mono)}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;font-family:var(--mono)}
.badge.queued{background:rgba(93,176,255,.14);color:var(--accent)}.badge.running{background:rgba(210,162,58,.16);color:var(--warn)}
.badge.done{background:rgba(63,185,80,.16);color:var(--ok)}.badge.failed,.badge.canceled{background:rgba(240,98,111,.16);color:var(--bad)}
button,select,input{font:inherit;color:var(--ink);background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 12px}
button{cursor:pointer}button:hover{border-color:var(--accent)}
.form{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.form input{flex:1;min-width:180px}
</style></head><body>
<header><h1><b>CCC</b> Control Plane</h1><span class="muted" id="gov">—</span><span class="spacer"></span><span class="muted">Phase 1 · ガバナー＋キュー</span></header>
<main>
  <div class="grid g4" id="kpis"></div>
  <div class="card"><h2>ジョブ投入</h2>
    <div class="form">
      <select id="repo"></select>
      <select id="kind"><option value="build">build（高速レーン）</option><option value="start">start（取締役会）</option><option value="plan">plan</option><option value="implement">implement</option></select>
      <input id="theme" placeholder="テーマ / 作るもの">
      <button id="add">＋ キューに追加</button>
    </div>
    <div class="muted" style="margin-top:8px">投入後、ガバナーが枠を見て自動起動します（枠が薄い間はqueuedのまま待機→reset後に自動消化）。</div>
  </div>
  <div class="card"><h2>キュー / 進行状況</h2><div id="jobs"></div></div>
  <div class="card"><h2>登録repo</h2><div id="repos"></div></div>
</main>
<script>
const $=s=>document.querySelector(s);const esc=s=>(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf=n=>(n==null?'—':Number(n).toLocaleString());
function resetIn(iso){if(!iso)return'';try{const m=Math.max(0,Math.round((new Date(iso)-new Date())/60000));return m>=60?Math.floor(m/60)+'時間'+(m%60)+'分':m+'分';}catch(e){return''}}
async function load(){
  const o=await(await fetch('/api/control')).json();const g=o.governor;
  $('#gov').textContent=g.admit?'✅ 投入可':('⏸ 停止: '+(g.reason==='budget'?('予算枠上限'+(g.resetAt?'（reset約'+resetIn(g.resetAt)+'）'):''):g.reason==='concurrency'?'同時実行上限':g.reason));
  $('#kpis').innerHTML=[['queued',o.stats.queued,''],['running',o.stats.running,'warn'],['done',o.stats.done,'ok'],['failed',o.stats.failed,o.stats.failed?'bad':'']]
    .map(([l,v,c])=>'<div class="card"><div class="kpi '+c+'">'+v+'<small>'+l+'</small></div></div>').join('');
  const jr=o.jobs.map(j=>'<tr><td><span class="badge '+j.state+'">'+j.state+'</span></td><td class="mono">'+esc(j.repo)+'</td><td>'+esc(j.kind)+'</td><td class="mono" style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(j.resolvedPrompt||j.prompt||(j.args&&j.args.theme)||'')+'</td><td class="mono">'+(j.tokensBefore!=null&&j.tokensAfter!=null?('+'+nf(j.tokensAfter-j.tokensBefore)):'')+'</td><td>'+(j.state==='queued'?'<button onclick="cancelJob(\\''+j.id+'\\')">取消</button>':'')+'</td></tr>').join('');
  $('#jobs').innerHTML='<table><tr><th>状態</th><th>repo</th><th>kind</th><th>プロンプト</th><th>Δtok</th><th></th></tr>'+(jr||'<tr><td colspan=6 class="muted">キューは空です</td></tr>')+'</table>';
  const sel=$('#repo');if(sel.dataset.init!=='1'){sel.innerHTML=o.repos.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.id)+'</option>').join('')||'<option value="">repos.json未登録</option>';sel.dataset.init='1';}
  $('#repos').innerHTML=o.repos.length?('<table><tr><th>id</th><th>path</th><th>branch</th><th>lane</th></tr>'+o.repos.map(r=>'<tr><td class="mono">'+esc(r.id)+'</td><td class="mono">'+esc(r.path)+'</td><td class="mono">'+esc(r.branch)+'</td><td>'+esc(r.lane)+'</td></tr>').join('')+'</table>'):'<div class="muted">repos.json が未登録です。repos.example.json をコピーして repos.json を作成してください。</div>';
}
async function cancelJob(id){await fetch('/api/cancel?id='+encodeURIComponent(id),{method:'POST'});load();}
$('#add').onclick=async()=>{const repo=$('#repo').value,kind=$('#kind').value,theme=$('#theme').value;if(!repo){alert('repoが未登録です');return;}await fetch('/api/enqueue?repo='+encodeURIComponent(repo)+'&kind='+encodeURIComponent(kind)+'&theme='+encodeURIComponent(theme),{method:'POST'});$('#theme').value='';load();};
load();setInterval(load,3000);
</script></body></html>`;
