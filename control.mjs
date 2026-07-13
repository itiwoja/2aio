#!/usr/bin/env node
// 2AIO Control Plane — 1画面で複数repoを進行させる司令塔(Phase 1: ガバナー＋キュー)
// 依存ゼロ。 node control.mjs → http://localhost:7900
// 設計: docs/CONTROL-PLANE.md
//  - サブスク(Claude Max)の共有5時間ブロックを ccusage で監視し、枠が薄ければジョブ投入を止める。
//  - repos.json に登録したrepoへ claude -p で2AIOレーンを spawn。基本は直列(サブスク枠共有のため)。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { claudeUsage, ccusageDebug } from './lib/ccusage.mjs';
import { admitJob } from './lib/governor.mjs';
import { loadQueue, enqueue, updateJob, nextQueued, countRunning, cancel, reconcile, propagateSkips } from './lib/queue.mjs';
import { claudeJSON } from './lib/claude.mjs';
import { parseRepoUrl, classifyRepo } from './lib/repo.mjs';
import { buildInterview, validateInterview, briefToPlanPrompt, IMPLEMENT_CHAIN_PROMPT } from './lib/intake.mjs';
import { parseApprovalMarker, budgetStopEvent, jobEvent, sendNotification } from './lib/notify.mjs';
import { mapIssueToJob, filterUnseen, finalizeAction, detectCompletion, loadSeen, saveSeen, fetchAutoIssues, moveIssueState, commentOnIssue } from './lib/linear.mjs';

// #22: ROOT/上限は env で注入可能（統合テストが一時ディレクトリで実レジストリを汚染しないため）。
// import 時の副作用（listen / setInterval / プリウォーム / reconcile）は末尾の main ガード内のみ。
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = process.env.AIO_CONTROL_ROOT || HERE;
const CFG = JSON.parse(fs.readFileSync(path.join(HERE, 'config.json'), 'utf8'));
const GOV = { tokenThreshold: 0.8, maxConcurrency: 1, pollMs: 5000, ...(CFG.governor || {}) };
// #7: Linear Issue駆動入口。tick(5s) とは別 interval（60s 以上を強制 — Linear API レート節約）。
const LINEAR = { pollMs: 60000, label: '2aio-auto', ...(CFG.linear || {}) };
const LINEAR_KEY = process.env.LINEAR_API_KEY || '';
const TOKEN_LIMIT = Number(process.env.AIO_TOKEN_LIMIT ?? (CFG.claudeMax5x?.tokenLimit || 0));
const PORT = process.env.AIO_CONTROL_PORT || 7900;
const CLAUDE = process.env.AIO_CLAUDE_BIN || process.env.CLAUDE_BIN || 'claude';
// テスト/ドライラン用に worker コマンドを丸ごと差し替え可能(既定は claude -p)
const WORKER_CMD = process.env.AIO_WORKER_CMD || '';

const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
// 同期 git ヘルパ (#3 Phase A)。code!==0 でも throw しない — 呼び出し側が判断する。
function git(dir, ...args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  return { code: r.status ?? -1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
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
  const all = loadRepos();
  const prev = all.find(r => r.id === rec.id) || {};
  const repos = all.filter(r => r.id !== rec.id);
  // #11: 既存フィールドをマージ（再登録で stack 等のカスタムフィールドを消さない）
  const merged = { ...prev, ...rec };
  repos.unshift(merged); saveRepos(repos); return merged;
}

// HTTPS(等)URLで登録 → workspaces/ に clone → 新規/既存を判定して状態を更新(非同期)。
function registerRepo(url) {
  const info = parseRepoUrl(url);
  if (!info) return { ok: false, err: 'URL解析に失敗（https://host/owner/name 形式）' };
  const id = `${info.owner}-${info.name}`.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
  const dest = path.join(WORKSPACES, info.name);
  const rec = { id, url, slug: info.slug, path: dest, branch: null, mode: null, state: 'cloning', error: null, defaultLane: 'build' };
  upsertRepo(rec);
  ensureDir(WORKSPACES);
  const alreadyCloned = fs.existsSync(path.join(dest, '.git'));
  const done = () => {
    const c = classifyRepo(dest);
    // #3 Phase A: 'main' ハードコードをやめ、clone 直後の HEAD から実デフォルトブランチを検出
    const head = git(dest, 'symbolic-ref', '--short', 'HEAD');
    const branch = head.code === 0 && head.out ? head.out : 'main';
    upsertRepo({ ...repoById(id), branch, mode: c.mode, state: 'ready', fileCount: c.fileCount, codeCount: c.codeCount, stack: c.stack || null });
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
    // #12: plan→implement の2連投入（段間でガバナーが予算待機でき、impl-plan がチェックポイントに残る）
    const planJob = enqueue(ROOT, { repo: id, kind: 'plan', prompt: briefToPlanPrompt(v.brief, repo) });
    const implJob = enqueue(ROOT, { repo: id, kind: 'implement', prompt: IMPLEMENT_CHAIN_PROMPT, dependsOn: planJob.id });
    rec.enqueuedJob = planJob.id; rec.chainJob = implJob.id; tick();
  } else {
    rec.messages.push({ role: 'assistant', content: v.question });
  }
  saveIntake(rec);
  return { ok: true, rec };
}

// #11: repo メモリの正本は workspaces/<repo>/CLAUDE.md（cwd 直下なので claude -p が自動ロードし、
// cwd 内書き込みなので権限問題も無い）。全 kind に「テストコマンド＋完了時のメモリ追記」を注入する。
function memoryPreamble(repo) {
  const parts = [];
  const t = repo?.stack?.testCmd; const b = repo?.stack?.buildCmd;
  if (t || b) parts.push(`このrepoのコマンド: ${[b && `ビルド=${b}`, t && `テスト=${t}`].filter(Boolean).join(' / ')}。検証にはこれを使う。`);
  parts.push('作業完了時、今後のジョブに有用な決定・構成理解・失敗の教訓があれば CLAUDE.md（無ければ作成）に簡潔に追記する。');
  return parts.join('\n');
}

// kind → 実行プロンプト(2AIOの入口レーンへ委譲)。prompt指定があればそれを優先。
function buildPrompt(job, repo = null) {
  const pre = memoryPreamble(repo);
  // #7 修正条件1: Done 遷移の責務はコントロールプレーンに一本化。Linear 起点ジョブでは
  // レーン内（2aio-implement-project 等）の Linear Done 遷移をスキップさせて二重遷移を防ぐ。
  const linearNote = job.args?.linearIssueId
    ? `\nこのジョブは Linear Issue ${job.args.linearIdentifier || job.args.linearIssueId} 起点で投入された。Linear への状態遷移・コメントはコントロールプレーンが行うため、レーン内の Linear 遷移手順（set-state 等）は実行しないこと。`
    : '';
  const wrap = (p) => (p ? `${p}\n\n---\n${pre}${linearNote}` : p);
  if (job.prompt) return wrap(job.prompt);
  const a = job.args || {};
  return wrap(corePrompt(job, a));
}
function corePrompt(job, a) {
  switch (job.kind) {
    case 'build': return `/2aio-build ${a.theme || ''} ${a.flags || '--auto'}`.trim();
    case 'start': return `/2aio-start-project ${a.theme || ''}`.trim();
    case 'plan': return `/2aio-plan-project ${a.prd || 'latest'}`.trim();
    case 'implement': return `/2aio-implement-project ${a.plan || 'latest'} ${a.flags || '--auto'}`.trim();
    case 'analyze': return `このリポジトリを解析してください。README・docs・主要なソースコードを読み、（gh コマンドが使えれば未解決 Issue も）確認したうえで、日本語で次を出力: ①アプリの目的と全体構成の理解、②具体的な改善案（優先度付き）、③2AIOエージェント（取締役会/planner/engineer/QA）で強化できる点。最後に、解析結果の要点（構成理解・主要コマンド・注意点）を CLAUDE.md に反映してください（無ければ作成。次回以降のジョブが自動ロードして使う）。`;
    // ── 開発 kind (#9)。feature/fix/issue は /2aio-dev レーン(#1)へ委譲 ──
    case 'feature': return `/2aio-dev . ${a.theme || ''} ${a.flags || '--auto'}`.trim();
    case 'fix': return `/2aio-dev . --fix ${a.theme || ''} ${a.flags || '--auto'}`.trim();
    case 'issue': return `gh issue view ${a.issue || a.target || a.theme} をコメント込みで読み、内容を1行に要約したうえで、バグ報告なら「/2aio-dev . --fix "{要約}" --auto」、機能要望なら「/2aio-dev . "{要約}" --auto」を実行してください。`;
    case 'test': return `このリポジトリのテストコマンドを検出して全実行してください（package.json scripts / Makefile / pytest 等）。失敗があれば原因を特定して修正し、全テストが緑になるまで繰り返す（最大3往復。直せなければ失敗内容を報告して終了）。テスト基盤が無ければ「テスト基盤なし」と報告して終了。`;
    case 'review': return `/code-review ${a.target}`.trim();
    case 'refactor': return `/refactor-clean ${a.target || ''}`.trim();
    // ── IDD ブリッジ (#23)。連鎖は intent→plan→mvp で必ず停止（削軸レビューは ikki の対話必須のため
    // idd-v1 は自動投入しない — IDDガードレール「削軸スキップ禁止」）──
    case 'idd-intent': return `/idd-intent ${a.theme || ''}`.trim();
    case 'idd-plan': return `idd/active/ の最新の intent（直前ジョブが作成したもの）を対象に /idd-plan を実行してください。スコープは Intent から逆算し、Intent に無い機能を足さないこと。`;
    case 'idd-mvp': return `idd/active/ の最新の plan を対象に /idd-mvp を実行してください。MVP 完了条件に答える最短経路のみ実装し、v1/v2 スコープに手を出さないこと。`;
    // pr は履歴公開アクションのため、devops Step 2.5 と同等の秘密スキャンをプロンプトに内蔵（正本性は崩さない）
    case 'pr': return `現在のブランチを PR にしてください。手順: (1) push 前に gitleaks（未導入なら git grep -iE "(api[_-]?key|secret|token|password)\\s*[:=]" $(git rev-list --all) 相当の履歴 grep で代替）で秘密情報スキャンを実行。leak>0 なら push せず [SECURITY_STOP] を出力して停止。 (2) clean なら push して gh pr create（本文に変更概要・テスト結果を記載）。 (3) PR URL を出力。`;
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

// ─── #15 通知（読み取り専用・失敗しても運用を壊さない） ───
const NOTIFY_CFG = CFG.notify || {};
let prevBudgetDecision = null;
const budgetSeen = new Set(); // 同一5hブロック(resetAt)内の budget_stop dedup

function notifyJob(job, ndjsonPath = null) {
  const ev = jobEvent(job);
  if (!ev) return;
  let tail = [];
  if (ndjsonPath) { try { tail = fs.readFileSync(ndjsonPath, 'utf8').trim().split('\n').slice(-20); } catch { /* ログ無し */ } }
  sendNotification(NOTIFY_CFG, ev, tail).catch(() => {});
}
function checkBudgetEdge(decision) {
  const ev = budgetStopEvent(prevBudgetDecision, decision, budgetSeen);
  prevBudgetDecision = decision;
  if (ev) sendNotification(NOTIFY_CFG, ev).catch(() => {});
}

// ─── ワーカー: ガバナー許可がある限り queued を起動する ───
const procs = new Map(); // jobId → child

// プロセスツリーごと停止 (#10)。Windows の child.kill() は claude.cmd 配下の node が残るため taskkill /T。
function treeKill(child) {
  if (!child || child.pid == null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try { child.kill('SIGKILL'); } catch { /* already dead */ }
  }
}

// kind別の最大実行時間 (#10)。config.json の governor.maxRuntimeMin: { default, analyze, ... } で上書き可。
const RUNTIME_MIN = { default: 120, analyze: 15, test: 30, review: 30, refactor: 30, ...(GOV.maxRuntimeMin || {}) };
const maxRuntimeMs = (kind) => (RUNTIME_MIN[kind] ?? RUNTIME_MIN.default) * 60_000;

// #14: 成果物リンクの一次ソースは state.md / deploy-report.md（「state.md が正本」原則）。
// ワーカー終了後に repo の output/*/state.md 最新を読み deployed_url / pr_url を拾う。
function collectArtifacts(repoPath) {
  try {
    const outDir = path.join(repoPath, 'output');
    if (!fs.existsSync(outDir)) return null;
    const dirs = fs.readdirSync(outDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(outDir, d.name, 'state.md')))
      .map((d) => path.join(outDir, d.name))
      .sort((a, b) => fs.statSync(path.join(b, 'state.md')).mtimeMs - fs.statSync(path.join(a, 'state.md')).mtimeMs);
    if (!dirs.length) return null;
    const state = fs.readFileSync(path.join(dirs[0], 'state.md'), 'utf8');
    const pick = (key) => state.match(new RegExp(`^${key}:\\s*(\\S+)\\s*$`, 'm'))?.[1];
    const deployedUrl = pick('deployed_url'), prUrl = pick('pr_url');
    return {
      outputDir: dirs[0],
      deployedUrl: deployedUrl && deployedUrl !== 'null' ? deployedUrl : null,
      prUrl: prUrl && prUrl !== 'null' ? prUrl : null,
    };
  } catch { return null; }
}

function startJob(job) {
  const repo = repoById(job.repo);
  if (!repo) { updateJob(ROOT, job.id, { state: 'failed', endedAt: new Date().toISOString(), log: [`repo未登録: ${job.repo}`] }); return; }

  // #3 Phase A: spawn 前に workspace を同期し HEAD を commitBefore として記録。
  // dirty / 非fast-forward では自動 stash・reset --hard を絶対にせず、ジョブを failed にして
  // UI にエラー提示（破壊的操作の自動実行禁止）。remote が無いローカル repo は同期をスキップ。
  let commitBefore = null;
  if (fs.existsSync(path.join(repo.path, '.git'))) {
    const dirty = git(repo.path, 'status', '--porcelain');
    if (dirty.code === 0 && dirty.out) {
      updateJob(ROOT, job.id, { state: 'failed', endedAt: new Date().toISOString(), log: ['[workspace] 作業ツリーが dirty のため起動しません（前ジョブの残骸の可能性）。手動で確認してください:', ...dirty.out.split('\n').slice(0, 10)] });
      return;
    }
    if (git(repo.path, 'remote').out) {
      const pull = git(repo.path, 'pull', '--ff-only');
      if (pull.code !== 0) {
        updateJob(ROOT, job.id, { state: 'failed', endedAt: new Date().toISOString(), log: ['[workspace] git pull --ff-only 失敗（非fast-forward等）。自動 reset はしません:', (pull.err || pull.out).slice(0, 300)] });
        return;
      }
    }
    const head = git(repo.path, 'rev-parse', 'HEAD');
    commitBefore = head.code === 0 ? head.out : null;
  }

  const prompt = buildPrompt(job, repo);
  const { active } = governorState();
  updateJob(ROOT, job.id, { state: 'running', startedAt: new Date().toISOString(), tokensBefore: active?.tokens ?? null, commitBefore, resolvedPrompt: prompt });

  // #14: stream-json ワーカー(-p 併用時 --verbose 必須)。WORKER_CMD 差替え時は素の出力が来るが、
  // 下の行パーサが JSON でない行を {type:'raw'} として扱うフォールバックで吸収する。
  //
  // ヘッドレス権限（eval 実走で発覚した設計ギャップの修正）: 既定モードでは Write/Edit/Read が
  // 対話承認待ち→auto-deny となり、ワーカーはファイルを1つも作れない。dangerously-skip-permissions は
  // 2AIO ルールで禁止のため、正規の acceptEdits + allowedTools 前置きで許可する
  // （Ring-1 guard フックは引き続き全ツール呼び出しを審査する）。config.json の worker で上書き可。
  const WK = CFG.worker || {};
  const PERMISSION_MODE = WK.permissionMode || 'acceptEdits';
  const ALLOWED_TOOLS = WK.allowedTools
    || 'Read,Write,Edit,Glob,Grep,Task,TodoWrite,WebFetch,WebSearch,Bash(npm:*),Bash(npx:*),Bash(node:*),Bash(git:*),Bash(gh:*),Bash(mkdir:*),Bash(curl:*),Bash(vercel:*),Bash(firebase:*)';
  let cmd, args;
  if (WORKER_CMD) { const parts = WORKER_CMD.split(' '); cmd = parts[0]; args = [...parts.slice(1), prompt]; }
  else {
    cmd = CLAUDE;
    // 引数順に注意: --allowedTools は可変長のため、後ろに置くとプロンプト位置引数まで
    // 飲み込んで「Input must be provided」エラーになる（eval 実走で発覚）。プロンプトを先頭に置く。
    args = ['-p', prompt, '--output-format', 'stream-json', '--verbose',
      '--permission-mode', PERMISSION_MODE, '--allowedTools', ALLOWED_TOOLS];
  }

  let child;
  try { child = spawn(cmd, args, { cwd: repo.path, windowsHide: true }); }
  catch (e) { updateJob(ROOT, job.id, { state: 'failed', endedAt: new Date().toISOString(), exit: -1, log: [String(e.message)] }); return; }
  procs.set(job.id, child);

  // #14: 全文ログは control/logs/<jobId>.ndjson に追記(200行キャップで主産物が消える問題の解消)。
  // queue.json の log[] は最新20行のプレビューに縮小(チャンクごとの全体書き込み負荷も低減)。
  ensureDir(path.join(ROOT, 'control', 'logs'));
  const ndjsonPath = path.join(ROOT, 'control', 'logs', `${job.id}.ndjson`);
  let lineBuf = '';           // チャンク境界で JSON 行が割れるため行バッファリング必須
  let finalResult = null;     // stream-json の type:'result' イベント(usage/total_cost_usd/is_error)
  const preview = [];
  const handleLine = (line) => {
    if (!line.trim()) return;
    let ev = null;
    try { ev = JSON.parse(line); } catch { /* not JSON */ }
    if (!ev) ev = { type: 'raw', text: line };
    fs.appendFileSync(ndjsonPath, JSON.stringify(ev) + '\n');
    if (ev.type === 'result') finalResult = ev;
    // プレビュー: テキストを持つイベントだけ拾う
    const text = ev.type === 'raw' ? ev.text
      : ev.type === 'result' ? (typeof ev.result === 'string' ? ev.result.slice(0, 200) : '[result]')
      : ev.type === 'assistant' ? (ev.message?.content?.find?.((c) => c.type === 'text')?.text || '').slice(0, 200)
      : null;
    if (text) {
      preview.push(text); while (preview.length > 20) preview.shift(); updateJob(ROOT, job.id, { log: [...preview] });
      // #15: 承認待ちマーカー検知 → waiting_approval 遷移＋通知（exit 0 でも done に上書きしない）。
      // マーカーはメッセージ途中の行にも現れうるため行単位で判定する。
      const marker = text.split('\n').map(parseApprovalMarker).find(Boolean);
      if (marker) {
        const j = updateJob(ROOT, job.id, { state: 'waiting_approval', waitingProject: marker.project });
        notifyJob(j);
      }
    }
  };
  const onData = (b) => {
    lineBuf += String(b);
    const lines = lineBuf.split('\n');
    lineBuf = lines.pop();
    lines.forEach(handleLine);
  };
  const push = (text) => handleLine(typeof text === 'string' ? text : String(text));
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.on('error', (e) => push('[spawn error] ' + e.message));
  // kind別タイムアウト (#10): 超過したらツリーごと停止(ハング1件で全repo停止を防ぐ)
  const killer = setTimeout(() => {
    push(`[timeout] ${RUNTIME_MIN[job.kind] ?? RUNTIME_MIN.default}分を超過したため停止します`);
    treeKill(child);
  }, maxRuntimeMs(job.kind));
  child.on('close', (code) => {
    clearTimeout(killer);
    if (lineBuf.trim()) handleLine(lineBuf); // 残りバッファのフラッシュ
    procs.delete(job.id);
    const { active: after } = governorState();
    const head = fs.existsSync(path.join(repo.path, '.git')) ? git(repo.path, 'rev-parse', 'HEAD') : null;
    // #14: envelope usage を一次指標に(ccusage 差分は全セッション合算で汚染されるため補助に格下げ)
    const usage = finalResult?.usage
      ? { input: finalResult.usage.input_tokens ?? null, output: finalResult.usage.output_tokens ?? null,
          cacheRead: finalResult.usage.cache_read_input_tokens ?? null, cacheCreate: finalResult.usage.cache_creation_input_tokens ?? null }
      : null;
    const failReason = code !== 0
      ? (finalResult?.is_error
        ? String(typeof finalResult.result === 'string' && finalResult.result ? finalResult.result : (finalResult.subtype || 'error')).slice(0, 160)
        : `exit ${code}`)
      : null;
    // #15: waiting_approval に遷移済みなら exit 0 でも done に上書きしない
    // #23: idd-mvp 完了は done でなく waiting_review（ikki の /idd-review 4軸レビュー待ちを可視化。
    //      後続の自動投入はしない — 削軸レビューは対話必須）
    const current = loadQueue(ROOT).find((x) => x.id === job.id);
    const nextState = current?.state === 'waiting_approval' ? 'waiting_approval'
      : (code === 0 && job.kind === 'idd-mvp') ? 'waiting_review'
      : (code === 0 ? 'done' : 'failed');
    const updated = updateJob(ROOT, job.id, {
      state: nextState, exit: code,
      endedAt: new Date().toISOString(), tokensAfter: after?.tokens ?? null,
      commitAfter: head && head.code === 0 ? head.out : null,
      usage, costUSD: finalResult?.total_cost_usd ?? null, failReason,
      artifacts: collectArtifacts(repo.path),
    });
    if (nextState !== 'waiting_approval') notifyJob(updated, ndjsonPath); // 承認待ちはマーカー時点で通知済み
    // #7: Linear 起点ジョブは終端状態(done/failed)でのみ Linear 側へ反映（非同期・失敗しても運用を壊さない）
    if (nextState === 'done' || nextState === 'failed') finalizeLinear(job, repo, code, failReason);
    tick(); // 1つ空いたので次を検討
  });
}

// ─── #7 Linear Issue駆動入口: 2aio-auto ラベル付き未着手 Issue をキューへ投入する ───
// ガバナーが入場判定を一元化しているため、ここは「キューに積むだけ」で安全に共存する。
// マップ不能 Issue（repo:/kind: ラベル不足）はスキップ＋案内コメント。案内はプロセス内で
// 1回に抑えるが linear-seen.json には記録しない — ラベルを直せば次の tick で拾われる。
const guidanceCommented = new Set();
let linearTicking = false;
async function linearTick() {
  if (linearTicking || !LINEAR_KEY) return; linearTicking = true;
  try {
    const r = await fetchAutoIssues(LINEAR_KEY, LINEAR.label);
    if (!r.ok) { console.error('[2aio-control] linear取得失敗: ' + r.err); return; }
    const seen = loadSeen(ROOT);
    for (const issue of filterUnseen(r.issues, seen)) {
      const m = mapIssueToJob(issue, loadRepos());
      if (!m.ok) {
        if (!guidanceCommented.has(issue.id)) {
          guidanceCommented.add(issue.id);
          await commentOnIssue(LINEAR_KEY, issue.id, m.comment);
        }
        continue; // seen に入れない（ラベル修正後に再評価させる）
      }
      const job = enqueue(ROOT, { repo: m.job.repo, kind: m.job.kind, args: m.job.args });
      seen.ids.push(issue.id); saveSeen(ROOT, seen);
      await moveIssueState(LINEAR_KEY, issue.id, 'In Progress');
      await commentOnIssue(LINEAR_KEY, issue.id, `[2aio-control job:${job.id}] キューに投入しました（repo=${m.job.repo} / kind=${m.job.kind}）。進行状況: http://localhost:${PORT}`);
    }
    tick();
  } catch (e) { console.error('[2aio-control] linearTick失敗: ' + e.message); }
  finally { linearTicking = false; }
}

// #7 修正条件1: ジョブ終了時の Linear 遷移。exit code だけで Done にせず、
// completion-report.md / state.md の phase: completed を確認できた場合のみ Done+要約。
// 確認できなければ「実行完了・要確認」コメントに留める。失敗は失敗コメント＋Todo 戻し。
async function finalizeLinear(job, repo, exit, failReason) {
  const issueId = job?.args?.linearIssueId;
  if (!issueId || !LINEAR_KEY) return;
  try {
    // 開始時刻より古い成果物は完了根拠にしない（過去プロジェクトの report で誤 Done しない）
    const completion = exit === 0 ? detectCompletion(repo.path, job.startedAt || null) : null;
    const act = finalizeAction({ exit, failReason, jobId: job.id, completion });
    await commentOnIssue(LINEAR_KEY, issueId, act.comment);
    if (act.state) await moveIssueState(LINEAR_KEY, issueId, act.state);
  } catch (e) { console.error('[2aio-control] linear完了処理失敗: ' + e.message); }
}

let ticking = false;
function tick() {
  if (ticking) return; ticking = true;
  try {
    propagateSkips(ROOT); // #12: 前段が死んだ後続を skipped に落とす(冪等)
    // 許可が出る限り queued を起動(maxConcurrencyまで)
    for (;;) {
      const { decision } = governorState();
      checkBudgetEdge(decision); // #15: budget 停止のエッジ検出(同一ブロック1回のみ)
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
    // #9: 開発 kind 用の args 拡張（target=review/refactor 対象、issue=Issue番号、flags=レーンフラグ）
    const target = u.searchParams.get('target') || (['review', 'refactor', 'issue'].includes(kind) ? theme : '');
    const issue = u.searchParams.get('issue') || '';
    const flags = u.searchParams.get('flags') || '';
    const notBefore = u.searchParams.get('notBefore') || null; // スケジュール投入 (#10)
    if (notBefore && Number.isNaN(Date.parse(notBefore))) return send(res, 422, 'application/json', JSON.stringify({ ok: false, err: 'notBefore は ISO 8601 日時で指定してください' }));
    if (!repoById(repo)) return send(res, 422, 'application/json', JSON.stringify({ ok: false, err: 'repo未登録' }));
    // review は clean checkout の headless 実行では未コミット差分が無いため、対象(PR番号/ブランチ差分)必須
    if (kind === 'review' && !target) return send(res, 422, 'application/json', JSON.stringify({ ok: false, err: 'review には target（PR番号 or ブランチ差分）が必須です' }));
    if (kind === 'issue' && !issue && !target) return send(res, 422, 'application/json', JSON.stringify({ ok: false, err: 'issue には Issue 番号が必須です' }));
    // #23: kind=idd は intent→plan→mvp の3連鎖投入（mvp で必ず停止。v1 は /idd-review 後に手動）
    if (kind === 'idd') {
      if (!theme) return send(res, 422, 'application/json', JSON.stringify({ ok: false, err: 'idd には theme（Intent の種）が必須です' }));
      const j1 = enqueue(ROOT, { repo, kind: 'idd-intent', args: { theme } });
      const j2 = enqueue(ROOT, { repo, kind: 'idd-plan', args: {}, dependsOn: j1.id });
      const j3 = enqueue(ROOT, { repo, kind: 'idd-mvp', args: {}, dependsOn: j2.id });
      tick();
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, jobs: [j1, j2, j3] }));
    }
    const job = enqueue(ROOT, { repo, kind, args: { theme, target, issue, flags }, prompt, notBefore });
    tick();
    return send(res, 200, 'application/json', JSON.stringify({ ok: true, job }));
  }
  if (u.pathname === '/api/job') { // #14: ジョブ詳細(フルログ末尾つき)
    const id = u.searchParams.get('id') || '';
    const job = loadQueue(ROOT).find((j) => j.id === id);
    if (!job) return send(res, 404, 'application/json', JSON.stringify({ ok: false, err: 'ジョブが見つからない' }));
    let logTail = [];
    const ndjsonPath = path.join(ROOT, 'control', 'logs', `${id}.ndjson`);
    try { logTail = fs.readFileSync(ndjsonPath, 'utf8').trim().split('\n').slice(-200); } catch { /* ログ無し */ }
    return send(res, 200, 'application/json', JSON.stringify({ ok: true, job, logTail, logPath: ndjsonPath }));
  }
  if (u.pathname === '/api/cancel' && req.method === 'POST') {
    const id = u.searchParams.get('id') || '';
    // 実行中キャンセル (#10): プロセスツリーを止めてから canceled に遷移
    const running = procs.get(id);
    if (running) {
      treeKill(running); procs.delete(id);
      updateJob(ROOT, id, { state: 'canceled', endedAt: new Date().toISOString() });
      tick();
      return send(res, 200, 'application/json', JSON.stringify({ ok: true, killed: true }));
    }
    const r = cancel(ROOT, id);
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
// #22: テストから server / tick を直接使えるよう export（main ガードにより import では listen しない）
export { server, tick };

// main ガード: 直接実行時のみ副作用を開始する（import 時はサーバ生成のみで listen しない）
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(HERE, 'control.mjs');
if (isMain) {
  // 起動時リコンシリエーション (#10): 前回プロセスの running 残骸を回収
  // (孤児1件で maxConcurrency=1 が永久に塞がるデッドロックの復旧。軽量kindのみ自動再キュー)
  const rec = reconcile(ROOT, (id) => procs.has(id));
  if (rec.interrupted.length || rec.requeued.length) {
    console.log(`[2aio-control] reconcile: interrupted=${rec.interrupted.join(',') || '-'} requeued=${rec.requeued.join(',') || '-'}`);
  }
  server.listen(PORT, '127.0.0.1', () => console.log(`[2aio-control] http://localhost:${PORT}`));
  claudeUsage(); // ccusage プリウォーム
  setInterval(tick, GOV.pollMs); // reset後などに自動で消化再開
  // #7: LINEAR_API_KEY がある場合のみ Linear ポーリング開始（60秒未満は 60 秒に切り上げ）
  if (LINEAR_KEY) {
    setInterval(linearTick, Math.max(60000, Number(LINEAR.pollMs) || 60000));
    console.log(`[2aio-control] linear polling: label=${LINEAR.label}`);
  }
}

const HTML = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>2AIO Control</title><style>
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
.badge.interrupted,.badge.waiting_approval,.badge.waiting_review{background:rgba(210,162,58,.16);color:var(--warn)}
.badge.skipped{background:rgba(154,167,180,.16);color:var(--sub)}
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
<header><h1><b>2AIO</b> Control Plane</h1><span class="muted" id="gov">—</span><span class="spacer"></span><span class="muted">Phase 1 · ガバナー＋キュー</span></header>
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
      <select id="kind"><option value="build">build（高速レーン）</option><option value="start">start（取締役会）</option><option value="plan">plan</option><option value="implement">implement</option><option value="analyze">analyze（解析）</option><option value="feature">feature（既存repoに機能追加）</option><option value="fix">fix（バグ修正）</option><option value="issue">issue（GitHub Issue番号から）</option><option value="test">test（テスト実行+修正）</option><option value="review">review（要target: PR番号/差分）</option><option value="refactor">refactor（死コード掃除）</option><option value="pr">pr（push+PR作成）</option><option value="idd">idd（intent→plan→mvp 連鎖。mvpで停止→/idd-review待ち）</option></select>
      <input id="theme" placeholder="テーマ / 機能記述 / Issue番号 / review対象（analyze・pr は不要）">
      <button id="add">＋ キューに追加</button>
    </div>
    <div class="muted" style="margin-top:8px">投入後、ガバナーが枠を見て自動起動します（枠が薄い間はqueuedのまま待機→reset後に自動消化）。</div>
  </div>
  <div class="card"><h2>キュー / 進行状況</h2><div id="jobs"></div></div>
</main>
<dialog id="jobdlg"><header class="dbody" style="display:flex;align-items:center"><b id="jd-title">ジョブ詳細</b><span class="spacer"></span><button onclick="document.getElementById('jobdlg').close()">閉じる</button></header>
  <div class="dbody"><div id="jd-meta" class="muted" style="margin-bottom:10px"></div>
    <div class="chat mono" id="jd-log" style="max-height:52vh;font-size:12px"></div>
    <div class="muted" style="margin-top:8px">コストはサブスクの推計値（請求額ではない）。相対比較の指標として使う。フルログ: control/logs/</div>
  </div></dialog>
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
  $('#gov').textContent=g.admit?'✅ 投入可':('⏸ 停止: '+(g.reason==='budget'?('予算枠上限'+(g.resetAt?'（reset約'+resetIn(g.resetAt)+'）':'')):g.reason==='concurrency'?'同時実行上限':g.reason));
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
  const jr=o.jobs.map(j=>'<tr><td><span class="badge '+j.state+'">'+j.state+'</span></td><td class="mono">'+esc(j.repo)+'</td><td>'+esc(j.kind)+'</td><td class="mono" style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(j.resolvedPrompt||j.prompt||(j.args&&j.args.theme)||'')+'</td><td class="mono">'+(j.usage?nf((j.usage.input||0)+(j.usage.output||0)):(j.tokensBefore!=null&&j.tokensAfter!=null?('Δ'+nf(j.tokensAfter-j.tokensBefore)):''))+'</td><td>'+(j.artifacts&&(j.artifacts.deployedUrl||j.artifacts.prUrl)?('<a href="'+esc(j.artifacts.deployedUrl||j.artifacts.prUrl)+'" target="_blank">成果物</a>'):'')+'</td><td>'+'<button class="mini" onclick="showJob(\\''+j.id+'\\')">詳細</button>'+(j.state==='queued'||j.state==='running'?' <button class="mini" onclick="cancelJob(\\''+j.id+'\\')">取消</button>':'')+'</td></tr>').join('');
  $('#jobs').innerHTML='<table><tr><th>状態</th><th>repo</th><th>kind</th><th>プロンプト</th><th>tok</th><th>成果物</th><th></th></tr>'+(jr||'<tr><td colspan=7 class="muted">キューは空です</td></tr>')+'</table>';
  const sel=$('#repo');const cur=sel.value;sel.innerHTML=o.repos.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.id)+'</option>').join('')||'<option value="">未登録</option>';if(cur)sel.value=cur;
  $('#repos').innerHTML=o.repos.length?o.repos.map(r=>{
    const st=r.state==='cloning'?'<span class="badge cloning">clone中…</span>':r.state==='error'?'<span class="badge error">エラー</span>':(r.mode?'<span class="badge '+r.mode+'">'+(r.mode==='new'?'新規':'既存')+'</span>':'');
    let act='';
    if(r.state==='error')act='<span class="muted">'+esc(r.error||'')+'</span>';
    else if(r.state==='cloning')act='<span class="muted">clone中…</span>';
    else if(r.mode==='new'){act=r.intake&&r.intake.done?'<span class="badge done">ヒアリング完了→実装投入済</span>':'<button class="mini" onclick="openIntake(\\''+r.id+'\\')">対話ヒアリングを開く</button>';}
    else if(r.mode==='existing')act='<button class="mini" onclick="analyze(\\''+r.id+'\\')">解析（改善案・2AIO強化）</button>';
    return '<div class="reporow">'+st+'<b class="mono">'+esc(r.slug||r.id)+'</b><span class="muted mono">'+esc(r.path||'')+'</span><span class="spacer"></span>'+act+'</div>';
  }).join(''):'<div class="muted">まだ登録がありません。上の「リポジトリ登録（HTTPS）」から追加してください。</div>';
}
async function cancelJob(id){await fetch('/api/cancel?id='+encodeURIComponent(id),{method:'POST'});load();}
async function showJob(id){const r=await(await fetch('/api/job?id='+encodeURIComponent(id))).json();if(!r.ok)return;
  const j=r.job;$('#jd-title').textContent='ジョブ詳細: '+j.id+' ('+j.kind+')';
  const u=j.usage?('in '+nf(j.usage.input)+' / out '+nf(j.usage.output)+' / cacheR '+nf(j.usage.cacheRead)):'—';
  $('#jd-meta').innerHTML='<b>'+esc(j.state)+'</b>'+(j.failReason?' ・ 失敗理由: '+esc(j.failReason):'')+' ・ usage: '+u+(j.costUSD!=null?' ・ 推計 $'+j.costUSD.toFixed(4):'')
    +(j.artifacts?('<br>成果物: '+(j.artifacts.deployedUrl?'<a href="'+esc(j.artifacts.deployedUrl)+'" target="_blank">'+esc(j.artifacts.deployedUrl)+'</a> ':'')+(j.artifacts.prUrl?'<a href="'+esc(j.artifacts.prUrl)+'" target="_blank">PR</a> ':'')+esc(j.artifacts.outputDir||'')):'');
  $('#jd-log').innerHTML=(r.logTail||[]).map(l=>{try{const e=JSON.parse(l);const t=e.type==='raw'?e.text:e.type==='result'?('[result] '+(typeof e.result==='string'?e.result:'')): e.type==='assistant'?((e.message&&e.message.content&&e.message.content.find(c=>c.type==='text')||{}).text||''):'';return t?'<div class="msg assistant">'+esc(t)+'</div>':'';}catch(_){return '<div class="msg assistant">'+esc(l)+'</div>';}}).join('')||'<span class="muted">ログなし</span>';
  $('#jobdlg').showModal();const c=$('#jd-log');c.scrollTop=c.scrollHeight;}
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
