#!/usr/bin/env node
// 2AIOForge ダッシュボード — ローカルLLM(Ollama)＋自己強化ループの監視
// 依存ゼロ。 node dashboard.mjs → http://localhost:7878
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readLog, rollback, historyItem } from './lib/history.mjs';
import { aggregateUsage } from './lib/usage.mjs';
import { claudeUsage } from './lib/ccusage.mjs';
import { resolvePaths } from './lib/paths.mjs';
import { approveProposal, archiveProposal } from './lib/proposals.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
CFG.paths = resolvePaths(ROOT, CFG.paths);
const OLLAMA = CFG.ollamaUrl || 'http://localhost:11434';
const PORT = process.env.AIOFORGE_PORT || 7878;

const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const ls = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const stat = (p) => { try { return fs.statSync(p); } catch { return null; } };

const PROP = CFG.paths.proposals;

let run = { running: false, topic: null, started: null, log: [] };

async function ollama() {
  const out = { reachable: false, tags: [], running: [] };
  try {
    const t = await (await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) })).json();
    out.reachable = true;
    out.tags = (t.models || []).map(m => ({ name: m.name, size: m.size }));
  } catch {}
  try {
    const p = await (await fetch(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(3000) })).json();
    out.running = (p.models || []).map(m => ({ name: m.name, size: m.size, expires: m.expires_at }));
  } catch {}
  return out;
}

function overview() {
  const runsDir = CFG.paths.runs, propDir = CFG.paths.proposals;
  const autoDir = path.join(CFG.paths.vault, 'knowledge', 'auto');
  const runs = ls(runsDir).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 30)
    .map(f => ({ file: f, ...(readJSON(path.join(runsDir, f)) || {}) }));
  const proposals = ls(propDir).filter(f => f.endsWith('.md')).map(f => {
    const p = path.join(propDir, f); const s = stat(p); const md = fs.readFileSync(p, 'utf8');
    const head = md.split('\n').slice(0, 6).join('\n');
    const side = readJSON(path.join(propDir, f.replace(/\.md$/, '.json'))) || {};
    const fromMd = (re) => (md.match(re) || [])[1] || '';
    const reason = side.rationale || fromMd(/## 提案理由[^\n]*\n([\s\S]*?)\n##/) || side.summary || fromMd(/## 要約\n([\s\S]*?)\n##/);
    const target = side.targetType === 'skill' ? 'skill:' + (side.target?.name || '') : (side.target?.file || (head.match(/→\s*(.+)/) || [])[1] || '');
    return { file: f, mtime: s?.mtimeMs, head, reason: (reason || '').trim().replace(/\s+/g, ' ').slice(0, 280), target, risk: side.risk || '', auditPass: side.audit?.pass };
  }).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  const applied = ls(autoDir).filter(f => f.endsWith('.md')).map(f => {
    const s = stat(path.join(autoDir, f)); return { file: f, mtime: s?.mtimeMs };
  }).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  // 集計
  let nApplied = 0, nProposed = 0, nIssues = 0, nTopics = 0;
  for (const r of runs) for (const t of (r.results || [])) {
    nTopics++;
    if (t.status === 'applied') nApplied++;
    else if (t.status === 'proposed') nProposed++;
    else if (/issue|error|failed/.test(t.status || '')) nIssues++;
  }
  const history = readLog(ROOT).slice(0, 50);
  const nHist = history.filter(h => h.kind === 'apply').length;
  return {
    config: { model: CFG.model, auditRounds: CFG.auditRounds, auditRoles: CFG.auditRoles, topics: CFG.topics.map(t => ({ id: t.id, target: t.target, risk: t.risk })) },
    stats: { runs: runs.length, topicRuns: nTopics, applied: nHist || nApplied, proposed: nProposed, issues: nIssues, lastRun: runs[0]?.stamp || null },
    runs, proposals, applied, history, run, usage: aggregateUsage(ROOT),
  };
}

function startRun(topic) {
  if (run.running) return;
  run = { running: true, topic: topic || 'all', started: new Date().toISOString(), log: [] };
  const a = ['run.mjs']; if (topic) a.push('--topic=' + topic);
  const child = spawn('node', a, { cwd: ROOT });
  const push = (b) => { String(b).split('\n').filter(Boolean).forEach(l => { run.log.push(l); if (run.log.length > 200) run.log.shift(); }); };
  child.stdout.on('data', push); child.stderr.on('data', push);
  child.on('close', (code) => { run.running = false; run.log.push(`[exit ${code}]`); });
}

const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };

// CSRF対策: 状態変更(POST)はブラウザ発ならOriginが自ホストであることを要求
// （127.0.0.1バインドでも、同じブラウザで開いた悪意あるサイトからのクロスオリジンPOSTは届くため）
function csrfBlocked(req) {
  if (req.method !== 'POST') return false;
  const origin = req.headers.origin;
  if (!origin) return false; // curl等の非ブラウザクライアントは許可
  return !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (csrfBlocked(req)) return send(res, 403, 'application/json', JSON.stringify({ ok: false, err: 'cross-origin POST拒否' }));
  if (u.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', HTML);
  if (u.pathname === '/api/overview') {
    const o = overview(); o.ollama = await ollama();
    o.claudeMax5x = { ...(CFG.claudeMax5x || {}), ...claudeUsage() };
    return send(res, 200, 'application/json', JSON.stringify(o));
  }
  if (u.pathname === '/api/proposal') {
    const f = path.basename(u.searchParams.get('file') || '');
    const p = path.join(CFG.paths.proposals, f);
    if (!f.endsWith('.md') || !fs.existsSync(p)) return send(res, 404, 'text/plain', 'not found');
    return send(res, 200, 'text/plain; charset=utf-8', fs.readFileSync(p, 'utf8'));
  }
  if (u.pathname === '/api/approve' && req.method === 'POST') {
    const f = path.basename(u.searchParams.get('file') || '');
    if (!f.endsWith('.md') || !fs.existsSync(path.join(PROP, f))) return send(res, 404, 'application/json', JSON.stringify({ ok: false, err: 'not found' }));
    let r;
    try { r = approveProposal(ROOT, CFG, f); } catch (e) { r = { ok: false, err: e.message }; }
    return send(res, r.ok ? 200 : 422, 'application/json', JSON.stringify(r));
  }
  if (u.pathname === '/api/reject' && req.method === 'POST') {
    const f = path.basename(u.searchParams.get('file') || '');
    if (!f.endsWith('.md') || !fs.existsSync(path.join(PROP, f))) return send(res, 404, 'application/json', JSON.stringify({ ok: false, err: 'not found' }));
    try { archiveProposal(CFG, f, 'rejected'); return send(res, 200, 'application/json', JSON.stringify({ ok: true })); }
    catch (e) { return send(res, 422, 'application/json', JSON.stringify({ ok: false, err: e.message })); }
  }
  if (u.pathname === '/api/run' && req.method === 'POST') {
    startRun(u.searchParams.get('topic') || null);
    return send(res, 200, 'application/json', JSON.stringify({ ok: true, run }));
  }
  if (u.pathname === '/api/history-item') {
    const it = historyItem(ROOT, u.searchParams.get('id') || '');
    if (!it) return send(res, 404, 'application/json', JSON.stringify({ ok: false }));
    return send(res, 200, 'application/json', JSON.stringify(it));
  }
  if (u.pathname === '/api/rollback' && req.method === 'POST') {
    const r = rollback(ROOT, u.searchParams.get('id') || '');
    return send(res, r.ok ? 200 : 422, 'application/json', JSON.stringify(r));
  }
  send(res, 404, 'text/plain', 'not found');
});
// 承認APIがファイル書き込みを伴うため、ローカル限定でバインド
server.listen(PORT, '127.0.0.1', () => console.log(`[2aio-dashboard] http://localhost:${PORT}`));
claudeUsage(); // ccusage(初回は数十秒)のプリウォーム。初回ページ表示を待たせない

const HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>2AIOForge モニター</title><style>
:root{--bg:#0f1216;--panel:#161b22;--panel2:#1c232c;--line:#2a323d;--ink:#e6edf3;--sub:#9aa7b4;--accent:#5db0ff;--ok:#3fb950;--warn:#d2a23a;--bad:#f0626f;--mono:"Cascadia Code",ui-monospace,Consolas,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:"Segoe UI",system-ui,sans-serif;line-height:1.5}
header{display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(15,18,22,.94);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);z-index:5}
h1{font-size:17px;margin:0;letter-spacing:.3px}h1 b{color:var(--accent)}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block}.dot.on{background:var(--ok);box-shadow:0 0 8px var(--ok)}.dot.off{background:var(--bad)}
.spacer{flex:1}
button{font:inherit;color:var(--ink);background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:8px 14px;cursor:pointer}
button:hover{border-color:var(--accent)}button:active{transform:scale(.97)}button:disabled{opacity:.5;cursor:default}
main{padding:20px 22px;max-width:1180px;margin:0 auto;display:grid;gap:18px}
.grid{display:grid;gap:14px}.g4{grid-template-columns:repeat(4,1fr)}.g2{grid-template-columns:1.3fr .7fr}
@media(max-width:820px){.g4{grid-template-columns:repeat(2,1fr)}.g2{grid-template-columns:1fr}}
@media(max-width:560px){
  header{padding:11px 13px;gap:8px}h1{font-size:15px}#sub{order:9;width:100%;font-size:11px;margin:-2px 0 0}
  #topic{flex:1;min-height:44px}#runBtn{min-height:44px}
  main{padding:13px 11px;gap:13px}.card{padding:13px;border-radius:11px}
  .kpi{font-size:23px}.card h2{margin-bottom:9px}
  th,td{padding:7px 8px}
  #runs,#ollama{overflow-x:auto;-webkit-overflow-scrolling:touch}#runs table,#ollama table{min-width:440px}
  .row{padding:11px 0}a.lnk{word-break:break-all}
  #proposals .row .spacer{flex-basis:100%;height:0}#proposals .mini{flex:1;min-height:44px}
  dialog{width:96%}pre{font-size:11px;max-height:66vh}
}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
.card h2{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--sub);margin:0 0 12px;font-weight:600}
.kpi{font-size:30px;font-weight:700;font-family:var(--mono)}.kpi small{display:block;font-size:12px;color:var(--sub);font-weight:400;letter-spacing:.5px;margin-top:2px}
.kpi.ok{color:var(--ok)}.kpi.warn{color:var(--warn)}.kpi.bad{color:var(--bad)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line)}th{color:var(--sub);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
td.mono,.mono{font-family:var(--mono)}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:600;font-family:var(--mono)}
.badge.applied{background:rgba(63,185,80,.16);color:var(--ok)}.badge.proposed{background:rgba(210,162,58,.16);color:var(--warn)}
.badge.bad{background:rgba(240,98,111,.16);color:var(--bad)}.badge.low{background:rgba(93,176,255,.14);color:var(--accent)}.badge.high{background:rgba(240,98,111,.14);color:var(--bad)}
.row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)}.row:last-child{border:0}
.reason{flex-basis:100%;font-size:12px;color:#c6d2de;background:#0b0e12;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:6px;padding:7px 10px;margin:2px 0}
.mini{padding:6px 13px;font-size:12px;border-radius:8px;min-height:38px}.mini.ok{color:var(--ok);border-color:rgba(63,185,80,.4)}.mini.bad{color:var(--bad);border-color:rgba(240,98,111,.4)}
a.lnk{color:var(--accent);text-decoration:none;cursor:pointer}a.lnk:hover{text-decoration:underline}
pre{background:#0b0e12;border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;font-family:var(--mono);font-size:12px;color:#cdd9e5;max-height:60vh}
.md{font-size:13px;line-height:1.7;max-height:72vh;overflow:auto}
.md h1.mh,.md h2.mh{font-size:15px;color:var(--accent);border-bottom:1px solid var(--line);padding-bottom:4px;margin:14px 0 8px}
.md h3{font-size:13px;margin:12px 0 6px;color:var(--ink)}
.md ul{margin:6px 0;padding-left:20px}.md li{margin:3px 0}
.md code{font-family:var(--mono);background:#0b0e12;padding:1px 5px;border-radius:5px;font-size:12px}
.md pre.code{background:#0b0e12;border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;font-family:var(--mono);font-size:12px;white-space:pre-wrap;color:#cdd9e5}
.md blockquote{border-left:3px solid var(--accent);margin:8px 0;padding:4px 12px;color:var(--sub)}
.muted{color:var(--sub);font-size:12px}.tags span{font-family:var(--mono);font-size:11px;color:var(--sub);margin-right:10px}
.live{font-family:var(--mono);font-size:12px;background:#0b0e12;border:1px solid var(--line);border-radius:8px;padding:10px;max-height:180px;overflow:auto;white-space:pre-wrap;color:#a9d4ff}
dialog{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:12px;max-width:820px;width:92%;padding:0}
dialog header{position:static;background:none;border-bottom:1px solid var(--line)}dialog .body{padding:16px}
</style></head><body>
<header>
  <span class="dot off" id="oll-dot"></span>
  <h1><b>2AIOForge</b> モニター</h1>
  <span class="muted" id="sub"></span>
  <span class="spacer"></span>
  <select id="topic" style="background:var(--panel2);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px"></select>
  <button id="runBtn">▶ 今すぐ実行</button>
</header>
<main>
  <div class="grid g4" id="kpis"></div>
  <div class="grid g2">
    <div class="card"><h2>実行履歴（runs）</h2><div id="runs"></div></div>
    <div class="card">
      <h2>ローカルLLM（Ollama）</h2><div id="ollama"></div>
      <h2 style="margin-top:16px">実行ログ（live）</h2><div class="live" id="live">—</div>
    </div>
  </div>
  <div class="card"><h2>提案（承認待ち）</h2><div id="proposals"></div></div>
  <div class="card"><h2>LLM使用量（トークン / コスト）</h2><div id="usage"></div></div>
  <div class="card"><h2>変更履歴（自動適用・元に戻せます）</h2><div id="history"></div></div>
  <div class="card"><h2>監視トピック</h2><div id="topics"></div></div>
</main>
<dialog id="dlg"><header><b id="dlg-t"></b> <span class="spacer"></span><button onclick="dlg.close()">閉じる</button></header><div class="body"><div id="dlg-c" class="md"></div></div></dialog>
<script>
const $=s=>document.querySelector(s); const esc=s=>(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtSize=b=>b?(b/1e9).toFixed(1)+'GB':''; const ago=ms=>{if(!ms)return'';const s=(Date.now()-ms)/1000;if(s<60)return Math.round(s)+'秒前';if(s<3600)return Math.round(s/60)+'分前';if(s<86400)return Math.round(s/3600)+'時間前';return Math.round(s/86400)+'日前';};
const sBadge=st=>{const m={applied:'applied',proposed:'proposed'};const c=m[st]||(/issue|error|failed|no-/.test(st)?'bad':'low');return '<span class="badge '+c+'">'+esc(st)+'</span>';};
let dlg=$('#dlg');
async function load(){
  const o=await (await fetch('/api/overview')).json();
  // ollama
  const oll=o.ollama; $('#oll-dot').className='dot '+(oll.reachable?'on':'off');
  $('#sub').textContent=(oll.reachable?'Ollama稼働':'Ollama停止')+' / '+o.config.model+' / 最終:'+(o.stats.lastRun||'—');
  $('#ollama').innerHTML='<div class="muted">状態: '+(oll.reachable?'稼働中':'停止')+(oll.running.length?' ・ <b style="color:var(--ok)">推論中: '+oll.running.map(m=>esc(m.name)).join(', ')+'</b>':' ・ アイドル')+'</div>'+
    '<table><tr><th>導入モデル</th><th>サイズ</th><th></th></tr>'+oll.tags.map(m=>'<tr><td class="mono">'+esc(m.name)+'</td><td class="mono">'+fmtSize(m.size)+'</td><td>'+(oll.running.some(r=>r.name===m.name)?'<span class="badge applied">推論中</span>':'')+'</td></tr>').join('')+'</table>';
  // kpis
  const k=o.stats; $('#kpis').innerHTML=[
    ['runs',k.runs,''],['自動適用',k.applied,'ok'],['提案',k.proposed,'warn'],['要対応',k.issues,k.issues?'bad':'']
  ].map(([l,v,c])=>'<div class="card"><div class="kpi '+c+'">'+v+'<small>'+l+'</small></div></div>').join('');
  // runs
  const rows=[]; for(const r of o.runs){ for(const t of (r.results||[])){ rows.push('<tr><td class="mono">'+esc(r.stamp||r.file)+'</td><td>'+esc(t.topic)+'</td><td>'+sBadge(t.status)+'</td><td class="mono">'+(t.sources||0)+'</td><td class="mono">'+(t.audit?(t.audit.pass?'PASS':'NG'+(t.round?'/r'+t.round:'')):'')+'</td></tr>'); } }
  $('#runs').innerHTML='<table><tr><th>日付</th><th>トピック</th><th>状態</th><th>出典</th><th>監査</th></tr>'+(rows.join('')||'<tr><td colspan=5 class="muted">まだ実行なし</td></tr>')+'</table>';
  // proposals（承認待ち一覧）
  $('#proposals').innerHTML=(o.proposals&&o.proposals.length)?o.proposals.map(p=>
    '<div class="row" style="flex-wrap:wrap;gap:8px">'
    +'<span class="badge '+(p.risk==='high'?'high':'low')+'">'+esc(p.risk||'?')+'</span>'
    +(p.auditPass===false?'<span class="badge bad">監査NG</span>':(p.auditPass===true?'<span class="badge applied">監査OK</span>':''))
    +'<a class="lnk mono" data-f="'+esc(p.file)+'" onclick="openProp(this.dataset.f)">'+esc(p.file)+'</a>'
    +'<span class="muted">→ '+esc(p.target)+' ・ '+ago(p.mtime)+'</span>'
    +(p.reason?'<div class="reason">理由: '+esc(p.reason)+'</div>':'')
    +'<span class="spacer"></span>'
    +'<button class="mini ok" data-f="'+esc(p.file)+'" onclick="act(\\'approve\\',this.dataset.f)">✔ 承認して反映</button>'
    +'<button class="mini bad" data-f="'+esc(p.file)+'" onclick="act(\\'reject\\',this.dataset.f)">✖ 却下</button>'
    +'</div>').join(''):'<div class="muted">承認待ちの提案はありません（skill更新・監査NG・--dry はここに溜まります）</div>';
  // usage（LLM使用量）
  const U=o.usage||{agg:{ollama:{},claude:{}},today:{},recent:[]};const oa=U.agg.ollama||{},ca=U.agg.claude||{},td=U.today||{};
  const nf=n=>(n||0).toLocaleString();
  // Claude Max x5 ゲージ（全Claude利用・現在の5時間ブロック）
  const cm=o.claudeMax5x||{}; const act=cm.active||null; const lim=cm.tokenLimit||0;
  const used=act?act.tokens:0; const pct=lim?Math.min(100,Math.round(used/lim*100)):0;
  const barCol=pct>=90?'var(--bad)':pct>=70?'var(--warn)':'var(--ok)';
  let reset=''; if(act&&act.end){try{const e=new Date(act.end);const mins=Math.max(0,Math.round((e-new Date(Date.now()))/60000));reset=mins>0?('リセットまで約'+(mins>=60?Math.floor(mins/60)+'時間'+(mins%60)+'分':mins+'分')):'まもなくリセット';}catch(e){}}
  const maxHtml=
    '<div style="margin-bottom:14px">'+
      '<div class="row" style="border:0;padding:0 0 6px"><b>🤖 Claude '+esc(cm.label||'Max x5')+' 利用状況</b>'+
        '<span class="muted" style="margin-left:8px">現在の5時間ブロック（全セッション合算）</span><span class="spacer"></span>'+
        (cm.ok?'<span class="muted">'+esc(reset)+'</span>':(cm.pending?'<span class="badge low">取得中…</span>':'<span class="badge bad">ccusage取得不可</span>'))+'</div>'+
      (act?
        '<div class="kpi" style="font-size:22px;color:'+barCol+'">'+nf(used)+'<small>'+nf(lim)+' tok 中（'+pct+'%）・$'+(act.cost||0).toFixed(2)+'</small></div>'+
        '<div style="height:9px;background:#0b0e12;border:1px solid var(--line);border-radius:999px;overflow:hidden;margin-top:8px"><div style="height:100%;width:'+pct+'%;background:'+barCol+'"></div></div>'
        :'<div class="muted">直近5時間のClaude利用なし（または ccusage 未取得）</div>')+
    '</div>';
  $('#usage').innerHTML=maxHtml+
    '<div class="grid g2" style="gap:12px">'+
      '<div><div class="muted" style="margin-bottom:6px">🖥 ローカル（Ollama '+esc(o.config.model)+'）＝無料</div>'+
        '<table><tr><th></th><th>入力</th><th>出力</th><th>コール</th></tr>'+
        '<tr><td class="muted">累計</td><td class="mono">'+nf(oa.inTok)+'</td><td class="mono">'+nf(oa.outTok)+'</td><td class="mono">'+nf(oa.calls)+'</td></tr></table></div>'+
      '<div><div class="muted" style="margin-bottom:6px">🤖 Claude（監査）＝従量</div>'+
        '<table><tr><th></th><th>入力</th><th>キャッシュ</th><th>出力</th><th>コスト</th></tr>'+
        '<tr><td class="muted">累計</td><td class="mono">'+nf(ca.inTok)+'</td><td class="mono">'+nf(ca.cacheTok)+'</td><td class="mono">'+nf(ca.outTok)+'</td><td class="mono" style="color:var(--warn)">$'+(ca.cost||0).toFixed(3)+'</td></tr>'+
        '<tr><td class="muted">本日</td><td class="mono" colspan=3>Claude '+nf(td.claudeTok)+'tok</td><td class="mono" style="color:var(--warn)">$'+(td.cost||0).toFixed(3)+'</td></tr></table></div>'+
    '</div>'+
    '<div class="muted" style="margin-top:8px;font-size:11px">※ claude -p は毎回プロジェクト文脈をキャッシュ読込するため1コールでも数万トークン＆$0.2前後かかります（コスト欄が実額）。ローカルはトークン消費のみで無料。</div>';
  // history（変更履歴）
  $('#history').innerHTML=(o.history&&o.history.length)?o.history.map(h=>{
    const k=h.kind==='rollback'?'<span class="badge low">巻戻し</span>':'<span class="badge applied">適用</span>';
    const ab=h.auditPass===false?'<span class="badge bad" style="margin-left:6px">監査NG</span>':(h.auditPass===true?'<span class="badge applied" style="margin-left:6px">監査OK</span>':'');
    let when='';try{when=new Date(h.time).toLocaleString('ja-JP')}catch(e){when=h.time||''}
    return '<div class="row" style="flex-wrap:wrap;gap:8px">'+k+'<b class="mono">'+esc(h.targetDisplay||h.targetPath||'')+'</b>'+ab+'<span class="muted">'+esc(when)+' ・ '+(h.bytesBefore||0)+'→'+(h.bytesAfter||0)+'字</span>'+(h.reason?'<div class="reason">理由: '+esc(h.reason)+'</div>':'')+'<span class="spacer"></span><button class="mini" onclick="openHist(\\''+esc(h.id)+'\\')">👁 差分</button>'+(h.kind!=='rollback'?'<button class="mini bad" onclick="doRollback(\\''+esc(h.id)+'\\')">元に戻す</button>':'')+'</div>';
  }).join(''):'<div class="muted">まだ変更なし（runを回すとここに自動適用の履歴が溜まります）</div>';
  // topics + select
  $('#topics').innerHTML=o.config.topics.map(t=>'<div class="row"><span class="badge '+(t.risk==='low'?'low':'high')+'">'+esc(t.risk)+'</span><span>'+esc(t.id)+'</span><span class="muted">→ '+esc(t.target.type==='skill'?'skill:'+t.target.name:t.target.file)+'</span></div>').join('');
  const sel=$('#topic'); if(sel.dataset.init!=='1'){ sel.innerHTML='<option value="">全トピック</option>'+o.config.topics.map(t=>'<option>'+esc(t.id)+'</option>').join(''); sel.dataset.init='1'; }
  // run state
  const rb=$('#runBtn'); rb.disabled=o.run.running; rb.textContent=o.run.running?'⏳ 実行中…':'▶ 今すぐ実行';
  $('#live').textContent=(o.run.log||[]).slice(-40).join('\\n')||'—';
}
function md(src){
  let h=esc(src); const blocks=[];
  h=h.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g,(m,l,c)=>{blocks.push(c.replace(/\\n$/,''));return '\\u0000'+(blocks.length-1)+'\\u0000';});
  h=h.replace(/^######\\s?(.+)$/gm,'<h3>$1</h3>').replace(/^#####\\s?(.+)$/gm,'<h3>$1</h3>').replace(/^####\\s?(.+)$/gm,'<h3>$1</h3>').replace(/^###\\s?(.+)$/gm,'<h3>$1</h3>').replace(/^##\\s?(.+)$/gm,'<h2 class="mh">$1</h2>').replace(/^#\\s?(.+)$/gm,'<h1 class="mh">$1</h1>');
  h=h.replace(/\\*\\*([^*]+)\\*\\*/g,'<b>$1</b>').replace(/\`([^\`]+)\`/g,'<code>$1</code>');
  h=h.replace(/\\[([^\\]]+)\\]\\((https?:[^)]+)\\)/g,'<a href="$2" target="_blank" class="lnk">$1</a>');
  h=h.replace(/^&gt;\\s?(.+)$/gm,'<blockquote>$1</blockquote>');
  h=h.replace(/^[-*]\\s+(.+)$/gm,'<li>$1</li>').replace(/(<li>[\\s\\S]*?<\\/li>)/g,'<ul>$1</ul>');
  h=h.replace(/\\n{2,}/g,'<br><br>').replace(/\\n/g,'<br>');
  h=h.replace(/\\u0000(\\d+)\\u0000/g,(m,i)=>'<pre class="code">'+blocks[+i]+'</pre>');
  return h;
}
async function openProp(f){const t=await (await fetch('/api/proposal?file='+encodeURIComponent(f))).text();$('#dlg-t').textContent=f;$('#dlg-c').innerHTML=md(t);dlg.showModal();}
async function openHist(id){
  const j=await (await fetch('/api/history-item?id='+encodeURIComponent(id))).json();
  if(!j||!j.rec){alert('履歴が見つかりません');return;}
  $('#dlg-t').textContent='差分: '+(j.rec.targetDisplay||j.rec.targetPath);
  $('#dlg-c').innerHTML='<h2 class="mh">適用後（現在）</h2><pre class="code">'+esc((j.current||'').slice(0,9000))+'</pre><h2 class="mh">適用前（バックアップ）</h2><pre class="code">'+esc((j.before||'(空＝新規作成)').slice(0,9000))+'</pre>';
  dlg.showModal();
}
async function doRollback(id){
  if(!confirm('この変更を元に戻します（バックアップから復元）。よろしいですか？'))return;
  const r=await (await fetch('/api/rollback?id='+encodeURIComponent(id),{method:'POST'})).json();
  if(!r.ok){alert('失敗: '+(r.err||''));return;}
  alert('元に戻しました'); load();
}
async function act(kind,file){
  const msg=(kind==='approve'?'承認して対象ファイルに反映します（上書き前にバックアップを取ります）':'却下してアーカイブします');
  if(!confirm(msg+':\\n'+file))return;
  const r=await (await fetch('/api/'+kind+'?file='+encodeURIComponent(file),{method:'POST'})).json();
  if(!r.ok){alert('失敗: '+(r.err||''));return;}
  if(kind==='approve')alert('反映しました:\\n'+r.applied);
  load();
}
$('#runBtn').onclick=async()=>{const t=$('#topic').value;await fetch('/api/run'+(t?'?topic='+encodeURIComponent(t):''),{method:'POST'});load();};
load(); setInterval(load,4000);
</script></body></html>`;
