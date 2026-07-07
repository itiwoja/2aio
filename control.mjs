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
import { claudeUsage, ccusageDebug } from './lib/ccusage.mjs';
import { admitJob } from './lib/governor.mjs';
import { loadQueue, enqueue, updateJob, nextQueued, countRunning, cancel } from './lib/queue.mjs';
import { claudeJSON } from './lib/claude.mjs';
import { parseRepoUrl, classifyRepo } from './lib/repo.mjs';
import { buildInterview, validateInterview, briefToBuildPrompt } from './lib/intake.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const GOV = { tokenThreshold: 0.8, maxConcurrency: 1, pollMs: 5000, ...(CFG.governor || {}) };
const TOKEN_LIMIT = CFG.claudeMax5x?.tokenLimit || 0;
const PORT = process.env.CCC_CONTROL_PORT || 7900;
const CLAUDE = process.env.CCC_CLAUDE_BIN || process.env.CLAUDE_BIN || 'claude';
// テスト/ドライラン用に worker コマンドを丸ごと差し替え可能(既定は claude -p)
const WORKER_CMD = process.env.CCC_WORKER_CMD || '';

const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });
const WORKSPACES = path.join(ROOT, 'workspaces');
const REPOS_FILE = path.join(ROOT, 'repos.json');

// 登録簿の正本は repos.json（UIのHTTPS登録で生成・更新）。未作成なら空。
// repos.example.json は「手で書く場合の見本」であり、自動では取り込まない（実レジストリを汚さない）。
function loadRepos() {
  const j = readJSON(REPOS_FILE);
  const repos = (j && Array.isArray(j.repos)) ? j.repos : [];
  return repos.filter(r => r && r.id);
}
function saveRepos(repos) { fs.writeFileSync(REPOS_FILE, JSON.stringify({ repos }, null, 2)); }
const repoById = (id) => loadRepos().find(r => r.id === id) || null;
function upsertRepo(rec) {
  const repos = loadRepos().filter(r => r.id !== rec.id);
  repos.unshift(rec); saveRepos(repos); return rec;
}

// HTTPS(等)URLで登録 → workspaces/ に clone → 新規/既存を判定して状態を更新(非同期)。
function registerRepo(url) {
  const info = parseRepoUrl(url);
  if (!info) return { ok: false, err: 'URL解析に失敗（https://host/owner/name 形式）' };
  const id = `${info.owner}-${info.name}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
  const dest = path.join(WORKSPACES, info.name);
  const rec = { id, url, slug: info.slug, path: dest, branch: 'main', mode: null, state: 'cloning', error: null, defaultLane: 'build' };
  upsertRepo(rec);
  ensureDir(WORKSPACES);
  const alreadyCloned = fs.existsSync(path.join(dest, '.git'));
  const done = () => {
    const c = classifyRepo(dest);
    upsertRepo({ ...repoById(id), mode: c.mode, state: 'ready', fileCount: c.fileCount, codeCount: c.codeCount });
    if (c.mode === 'new') seedIntake(id); // 新規は対話ヒアリングを用意
  };
  if (alreadyCloned) { done(); return { ok: true, repo: repoById(id), reused: true }; }
  let cp; try { cp = spawn('git', ['clone', '--depth', '50', url, dest], { windowsHide: true }); }
  catch (e) { upsertRepo({ ...rec, state: 'error', error: String(e.message) }); return { ok: false, err: String(e.message) }; }
  let err = '';
  cp.stderr.on('data', d => err += d);
  cp.on('error', e => upsertRepo({ ...repoById(id), state: 'error', error: String(e.message) }));
  cp.on('close', code => { if (code === 0) done(); else upsertRepo({ ...repoById(id), state: 'error', error: (err || 'git clone失敗').slice(0, 300) }); });
  return { ok: true, repo: rec };
}

// ─── 対話ヒアリング(新規repo) ── control/intake/<id>.json に会話を永続化 ───
const intakeFile = (id) => path.join(ROOT, 'control', 'intake', `${id}.json`);
const loadIntake = (id) => readJSON(intakeFile(id));
function saveIntake(rec) { ensureDir(path.dirname(intakeFile(rec.repoId))); fs.writeFileSync(intakeFile(rec.repoId), JSON.stringify(rec, null, 2)); return rec; }
function seedIntake(id) {
  if (loadIntake(id)) return;
  saveIntake({ repoId: id, messages: [{ role: 'assistant', content: 'どんなアプリを作りたいですか？目的や作りたいものを教えてください。' }], done: false, brief: '', enqueuedJob: null });
}
// ユーザー回答を受け、Claude(サブスク)に次の1問 or 完了(brief)を出させる。完了なら実装ジョブを投入。
async function intakeAnswer(id, text) {
  const repo = repoById(id); if (!repo) return { ok: false, err: 'repo未登録' };
  let rec = loadIntake(id) || { repoId: id, messages: [], done: false, brief: '', enqueuedJob: null };
  if (rec.done) return { ok: true, rec };
  if (text) rec.messages.push({ role: 'user', content: String(text).slice(0, 2000) });
  const { sys, user } = buildInterview(rec.messages, repo);
  let obj; try { obj = await claudeJSON(sys + '\n\n' + user, { timeoutMs: 120000 }); } catch (e) { return { ok: false, err: 'claude呼び出し失敗: ' + e.message }; }
  const v = validateInterview(obj);
  if (!v) return { ok: false, err: 'ヒアリング応答が不正（claudeがJSONを返さなかった可能性）' };
  if (v.done) {
    rec.done = true; rec.brief = v.brief;
    const job = enqueue(ROOT, { repo: id, kind: 'implement', prompt: briefToBuildPrompt(v.brief, repo) });
    rec.enqueuedJob = job.id; tick();
  } else {
    rec.messages.push({ role: 'assistant', content: v.question });
  }
  saveIntake(rec);
  return { ok: true, rec };
}

// kind → 実行プロンプト(CCCの入口レーンへ委譲)。prompt指定があればそれを優先。
function buildPrompt(job) {
  if (job.prompt) return job.prompt;
  const a = job.args || {};
  switch (job.kind) {
    case 'build': return `/ccc-build ${a.theme || ''} ${a.flags || '--auto'}`.trim();
    case 'start': return `/ccc-start-project ${a.theme || ''}`.trim();
    case 'plan': return `/ccc-plan-project ${a.prd || 'latest'}`.trim();
    case 'implement': return `/ccc-implement-project ${a.plan || 'latest'} ${a.flags || '--auto'}`.trim();
    case 'analyze': return `このリポジトリを解析してください。README・docs・主要なソースコードを読み、（gh コマンドが使えれば未解決 Issue も）確認したうえで、日本語で次を出力: ①アプリの目的と全体構成の理解、②具体的な改善案（優先度付き）、③CCCエージェント（取締役会/planner/engineer/QA）で強化できる点。`;
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
    repos: loadRepos().map(r => {
      const intake = r.mode === 'new' ? loadIntake(r.id) : null;
      return { id: r.id, slug: r.slug || '', url: r.url || '', path: r.path, branch: r.branch || '', lane: r.defaultLane || 'build',
        mode: r.mode || null, state: r.state || 'ready', error: r.error || null,
        intake: intake ? { done: !!intake.done, turns: intake.messages.length, enqueuedJob: intake.enqueuedJob } : null };
    }),
    stats: { queued: by('queued'), running: by('running'), done: by('done'), failed: by('failed') },
    jobs,
  };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (csrfBlocked(req)) return send(res, 403, 'application/json', JSON.stringify({ ok: false, err: 'cross-origin POST拒否' }));
  if (u.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', HTML);
  if (u.pathname === '/api/control') return send(res, 200, 'application/json', JSON.stringify(overview()));
  if (u.pathname === '/api/debug') {
    const g = governorState();
    claudeUsage(); // 裏で更新を促す
    return send(res, 200, 'application/json', JSON.stringify({ tokenLimit: TOKEN_LIMIT, governor: g.decision, usage: g.usage, ccusage: ccusageDebug() }, null, 2));
  }
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
  if (u.pathname === '/api/register' && req.method === 'POST') {
    const r = registerRepo(u.searchParams.get('url') || '');
    return send(res, r.ok ? 200 : 422, 'application/json', JSON.stringify(r));
  }
  if (u.pathname === '/api/intake') { // GET: 会話取得
    const rec = loadIntake(u.searchParams.get('repo') || '');
    return send(res, 200, 'application/json', JSON.stringify(rec || { messages: [], done: false }));
  }
  if (u.pathname === '/api/intake/answer' && req.method === 'POST') {
    const r = await intakeAnswer(u.searchParams.get('repo') || '', u.searchParams.get('text') || '');
    return send(res, r.ok ? 200 : 422, 'application/json', JSON.stringify(r));
  }
  if (u.pathname === '/api/analyze' && req.method === 'POST') {
    const repo = u.searchParams.get('repo') || '';
    if (!repoById(repo)) return send(res, 422, 'application/json', JSON.stringify({ ok: false, err: 'repo未登録' }));
    const job = enqueue(ROOT, { repo, kind: 'analyze' }); tick();
    return send(res, 200, 'application/json', JSON.stringify({ ok: true, job }));
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
.badge.done{background:rgba(63,185,80,.16);color:var(--ok)}.badge.failed,.badge.canceled,.badge.error{background:rgba(240,98,111,.16);color:var(--bad)}
.badge.new{background:rgba(93,176,255,.14);color:var(--accent)}.badge.existing{background:rgba(63,185,80,.16);color:var(--ok)}.badge.cloning{background:rgba(210,162,58,.16);color:var(--warn)}
button,select,input{font:inherit;color:var(--ink);background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 12px}
button{cursor:pointer}button:hover{border-color:var(--accent)}button.mini{padding:5px 11px;font-size:12px}
.form{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.form input{flex:1;min-width:180px}
.gauge{height:12px;background:#0b0e12;border:1px solid var(--line);border-radius:999px;overflow:hidden;margin-top:10px}.gauge>div{height:100%;transition:width .4s}
.reporow{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}.reporow:last-child{border:0}
dialog{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:12px;max-width:640px;width:94%;padding:0}
dialog header{position:static;background:none;border-bottom:1px solid var(--line)}.dbody{padding:16px}
.chat{max-height:46vh;overflow:auto;display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
.msg{padding:8px 12px;border-radius:10px;font-size:13px;max-width:85%}
.msg.assistant{background:var(--panel2);border:1px solid var(--line);align-self:flex-start}
.msg.user{background:rgba(93,176,255,.14);align-self:flex-end}
</style></head><body>
<header><h1><b>CCC</b> Control Plane</h1><span class="muted" id="gov">—</span><span class="spacer"></span><span class="muted">Phase 1 · ガバナー＋キュー</span></header>
<main>
  <div class="card">
    <h2>共有トークン予算（Claude Max 5時間ブロック）</h2>
    <div id="budget" class="muted">—</div><div class="gauge"><div id="bar"></div></div>
  </div>
  <div class="grid g4" id="kpis"></div>
  <div class="card"><h2>リポジトリ登録（HTTPS）</h2>
    <div class="form">
      <input id="url" placeholder="https://github.com/owner/name">
      <button id="reg">登録して clone</button>
    </div>
    <div class="muted" style="margin-top:8px">登録すると workspaces/ に clone し、<b>新規</b>なら対話ヒアリング→計画・実装、<b>既存</b>ならコード/docs/Issueを解析して改善案を出します。（private は事前に git 認証が必要）</div>
  </div>
  <div class="card"><h2>登録repo</h2><div id="repos"></div></div>
  <div class="card"><h2>ジョブ投入（既存repoの手動レーン）</h2>
    <div class="form">
      <select id="repo"></select>
      <select id="kind"><option value="build">build（高速レーン）</option><option value="start">start（取締役会）</option><option value="plan">plan</option><option value="implement">implement</option><option value="analyze">analyze（解析）</option></select>
      <input id="theme" placeholder="テーマ / 作るもの（analyzeは不要）">
      <button id="add">＋ キューに追加</button>
    </div>
    <div class="muted" style="margin-top:8px">投入後、ガバナーが枠を見て自動起動します（枠が薄い間はqueuedのまま待機→reset後に自動消化）。</div>
  </div>
  <div class="card"><h2>キュー / 進行状況</h2><div id="jobs"></div></div>
</main>
<dialog id="intake"><header class="dbody" style="display:flex;align-items:center"><b id="ik-title">対話ヒアリング</b><span class="spacer"></span><button onclick="document.getElementById('intake').close()">閉じる</button></header>
  <div class="dbody"><div class="chat" id="ik-chat"></div>
    <div class="form"><input id="ik-input" placeholder="回答を入力…"><button id="ik-send">送信</button></div>
    <div class="muted" id="ik-note" style="margin-top:8px"></div>
  </div></dialog>
<script>
const $=s=>document.querySelector(s);const esc=s=>(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nf=n=>(n==null?'—':Number(n).toLocaleString());
function resetIn(iso){if(!iso)return'';try{const m=Math.max(0,Math.round((new Date(iso)-new Date())/60000));return m>=60?Math.floor(m/60)+'時間'+(m%60)+'分':m+'分';}catch(e){return''}}
async function load(){
  const o=await(await fetch('/api/control')).json();const g=o.governor;
  const pct=g.usedPct==null?null:Math.round(g.usedPct*100);
  const thr=Math.round(g.threshold*100);
  const col=pct==null?'var(--sub)':pct>=thr?'var(--bad)':pct>=70?'var(--warn)':'var(--ok)';
  $('#gov').textContent=g.admit?'✅ 投入可':('⏸ 停止: '+(g.reason==='budget'?('予算枠上限'+(g.resetAt?'（reset約'+resetIn(g.resetAt)+'）'):''):g.reason==='concurrency'?'同時実行上限':g.reason));
  const tl=g.tokenLimit?(g.tokenLimit>=1e6?(g.tokenLimit/1e6).toFixed(0)+'M':nf(g.tokenLimit)):'—';
  const ut=g.usedTokens==null?null:(g.usedTokens>=1e6?(g.usedTokens/1e6).toFixed(1)+'M':nf(g.usedTokens));
  $('#budget').innerHTML=g.tokenLimit?(
    '<span class="mono" style="font-size:28px;font-weight:700;color:'+col+'">'+(pct==null?'—':pct+'%')+'</span>'+
    '<span class="muted"> ・ '+(ut==null?'使用量取得待ち':ut+' / '+tl+' tok')+' ・ 上限'+thr+'%で新規投入を停止'+
    (g.resetAt?' ・ リセットまで約'+resetIn(g.resetAt):'')+'</span>'+
    (!g.usageOk?(g.usagePending?' <span class="badge cloning">ccusage取得中…</span>':' <span class="badge error">ccusage取得不可（/api/debug で確認）</span>'):'')
  ):'tokenLimit未設定（config.json の claudeMax5x.tokenLimit）';
  $('#bar').style.width=(pct||0)+'%';$('#bar').style.background=col;
  $('#kpis').innerHTML=[['queued',o.stats.queued,''],['running',o.stats.running,'warn'],['done',o.stats.done,'ok'],['failed',o.stats.failed,o.stats.failed?'bad':'']]
    .map(([l,v,c])=>'<div class="card"><div class="kpi '+c+'">'+v+'<small>'+l+'</small></div></div>').join('');
  const jr=o.jobs.map(j=>'<tr><td><span class="badge '+j.state+'">'+j.state+'</span></td><td class="mono">'+esc(j.repo)+'</td><td>'+esc(j.kind)+'</td><td class="mono" style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(j.resolvedPrompt||j.prompt||(j.args&&j.args.theme)||'')+'</td><td class="mono">'+(j.tokensBefore!=null&&j.tokensAfter!=null?('+'+nf(j.tokensAfter-j.tokensBefore)):'')+'</td><td>'+(j.state==='queued'?'<button onclick="cancelJob(\\''+j.id+'\\')">取消</button>':'')+'</td></tr>').join('');
  $('#jobs').innerHTML='<table><tr><th>状態</th><th>repo</th><th>kind</th><th>プロンプト</th><th>Δtok</th><th></th></tr>'+(jr||'<tr><td colspan=6 class="muted">キューは空です</td></tr>')+'</table>';
  const sel=$('#repo');const cur=sel.value;sel.innerHTML=o.repos.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.id)+'</option>').join('')||'<option value="">未登録</option>';if(cur)sel.value=cur;
  $('#repos').innerHTML=o.repos.length?o.repos.map(r=>{
    const st=r.state==='cloning'?'<span class="badge cloning">clone中…</span>':r.state==='error'?'<span class="badge error">エラー</span>':(r.mode?'<span class="badge '+r.mode+'">'+(r.mode==='new'?'新規':'既存')+'</span>':'');
    let act='';
    if(r.state==='error')act='<span class="muted">'+esc(r.error||'')+'</span>';
    else if(r.state==='cloning')act='<span class="muted">clone中…</span>';
    else if(r.mode==='new'){act=r.intake&&r.intake.done?'<span class="badge done">ヒアリング完了→実装投入済</span>':'<button class="mini" onclick="openIntake(\\''+r.id+'\\')">対話ヒアリングを開く</button>';}
    else if(r.mode==='existing')act='<button class="mini" onclick="analyze(\\''+r.id+'\\')">解析（改善案・CCC強化）</button>';
    return '<div class="reporow">'+st+'<b class="mono">'+esc(r.slug||r.id)+'</b><span class="muted mono">'+esc(r.path||'')+'</span><span class="spacer"></span>'+act+'</div>';
  }).join(''):'<div class="muted">まだ登録がありません。上の「リポジトリ登録（HTTPS）」から追加してください。</div>';
}
async function cancelJob(id){await fetch('/api/cancel?id='+encodeURIComponent(id),{method:'POST'});load();}
$('#add').onclick=async()=>{const repo=$('#repo').value,kind=$('#kind').value,theme=$('#theme').value;if(!repo){alert('repoが未登録です');return;}await fetch('/api/enqueue?repo='+encodeURIComponent(repo)+'&kind='+encodeURIComponent(kind)+'&theme='+encodeURIComponent(theme),{method:'POST'});$('#theme').value='';load();};
$('#reg').onclick=async()=>{const url=$('#url').value.trim();if(!url)return;$('#reg').disabled=true;$('#reg').textContent='登録中…';const r=await(await fetch('/api/register?url='+encodeURIComponent(url),{method:'POST'})).json();$('#reg').disabled=false;$('#reg').textContent='登録して clone';if(!r.ok){alert('登録失敗: '+(r.err||''));return;}$('#url').value='';load();};
async function analyze(id){await fetch('/api/analyze?repo='+encodeURIComponent(id),{method:'POST'});alert('解析ジョブをキューに投入しました。進行状況は下のキューで確認できます。');load();}
// ── 対話ヒアリング ──
let IKID=null;
async function openIntake(id){IKID=id;$('#ik-title').textContent='対話ヒアリング: '+id;$('#intake').showModal();await ikLoad();}
async function ikLoad(){const rec=await(await fetch('/api/intake?repo='+encodeURIComponent(IKID))).json();
  $('#ik-chat').innerHTML=(rec.messages||[]).map(m=>'<div class="msg '+(m.role==='user'?'user':'assistant')+'">'+esc(m.content)+'</div>').join('');
  const c=$('#ik-chat');c.scrollTop=c.scrollHeight;
  if(rec.done){$('#ik-note').innerHTML='✅ ヒアリング完了。要件から実装ジョブを投入しました。';$('#ik-input').disabled=true;$('#ik-send').disabled=true;}
  else{$('#ik-note').textContent='';$('#ik-input').disabled=false;$('#ik-send').disabled=false;}}
$('#ik-send').onclick=async()=>{const t=$('#ik-input').value.trim();if(!t)return;$('#ik-input').value='';$('#ik-send').disabled=true;$('#ik-note').textContent='考え中…（Claudeが次の質問を作成）';
  const r=await(await fetch('/api/intake/answer?repo='+encodeURIComponent(IKID)+'&text='+encodeURIComponent(t),{method:'POST'})).json();
  $('#ik-send').disabled=false;if(!r.ok){$('#ik-note').textContent='失敗: '+(r.err||'');return;}await ikLoad();load();};
load();setInterval(load,3000);
</script></body></html>`;
