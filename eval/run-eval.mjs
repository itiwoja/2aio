#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_GITLEAKS = 'C:/Users/1kkim/projects/tools/gitleaks/gitleaks.exe';
const METRIC_DIRECTIONS = {
  gitleaksLeaks: 'lower', failForward: 'lower', escalation: 'lower', skippedDep: 'lower',
  qaPassRate: 'higher', tasksFailed: 'lower', tokensUsed: 'lower',
};

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 2;
}

function parseArgs(argv) {
  const options = { theme: path.join(ROOT, 'eval', 'themes', 'todo-pwa.json'), port: 7900, timeoutMin: 60, scoreOnly: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--theme') options.theme = argv[++i] || '';
    else if (arg === '--port') options.port = Number(argv[++i]);
    else if (arg === '--timeout-min') options.timeoutMin = Number(argv[++i]);
    else if (arg === '--score-only') options.scoreOnly = argv[++i] || '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('--port must be 1-65535');
  if (!Number.isFinite(options.timeoutMin) || options.timeoutMin <= 0) throw new Error('--timeout-min must be positive');
  if (options.scoreOnly === '') throw new Error('--score-only needs a project directory');
  return options;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function countMatches(text, marker) {
  return (text.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

function findStateFiles(dir) {
  const found = [];
  const visit = (current) => {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name === 'state.md') found.push(target);
    }
  };
  visit(dir);
  return found.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function readTasksFailed(state) {
  const match = state.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const value = match[1].match(/^\s*tasks_failed\s*:\s*['\"]?(\d+)['\"]?\s*(?:#.*)?$/mi);
  return value ? Number(value[1]) : null;
}

function gitleaksLeaks(artifactDir) {
  const binary = process.env.GITLEAKS_BIN || DEFAULT_GITLEAKS;
  const report = path.join(os.tmpdir(), `2aio-gitleaks-${process.pid}-${Date.now()}.json`);
  try {
    const run = spawnSync(binary, ['detect', '--no-git', '--no-banner', '-s', artifactDir, '-r', report, '-f', 'json'], {
      encoding: 'utf8', windowsHide: true,
    });
    if (run.error || ![0, 1].includes(run.status)) return null;
    if (run.status === 0) return 0;
    try {
      const findings = readJson(report);
      return Array.isArray(findings) ? findings.length : null;
    } catch { return null; }
  } finally {
    try { fs.rmSync(report, { force: true }); } catch { /* best effort */ }
  }
}

export function scoreProject(projectDir, job = null) {
  const resolvedProjectDir = path.resolve(projectDir);
  // 成果物ディレクトリ (output/{slug}) 直渡しにも repo ルート渡しにも対応する
  const directState = path.join(resolvedProjectDir, 'state.md');
  const outputDir = path.join(resolvedProjectDir, 'output');
  const stateFile = fs.existsSync(directState) ? directState
    : fs.existsSync(outputDir) ? findStateFiles(outputDir)[0] : null;
  const emptyMetrics = {
    gitleaksLeaks: null, failForward: null, escalation: null, skippedDep: null,
    qaPassRate: null, tasksFailed: null, tokensUsed: null,
  };
  if (!stateFile) return { pass: false, reason: 'NO_ARTIFACT', metrics: emptyMetrics, projectDir: resolvedProjectDir };

  const artifactDir = path.dirname(stateFile);
  const state = fs.readFileSync(stateFile, 'utf8');
  const logFile = path.join(artifactDir, 'build-log.md');
  const qaFile = path.join(artifactDir, 'qa-report.md');
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : null;
  const qa = fs.existsSync(qaFile) ? fs.readFileSync(qaFile, 'utf8') : null;
  const passed = qa ? countMatches(qa, '✅') : 0;
  const failed = qa ? countMatches(qa, '❌') : 0;
  const metrics = {
    gitleaksLeaks: gitleaksLeaks(artifactDir),
    failForward: log === null ? null : countMatches(log, '[FAIL_FORWARD]'),
    escalation: log === null ? null : countMatches(log, '[ESCALATION]'),
    skippedDep: log === null ? null : countMatches(log, '[SKIPPED_DEP]'),
    qaPassRate: passed + failed === 0 ? null : passed / (passed + failed),
    tasksFailed: readTasksFailed(state),
    // 5h ブロック境界を跨ぐと after < before の負値になり得るため null 扱い（Issue #25 修正条件4）
    tokensUsed: Number.isFinite(job?.tokensBefore) && Number.isFinite(job?.tokensAfter)
      && job.tokensAfter - job.tokensBefore >= 0
      ? job.tokensAfter - job.tokensBefore : null,
  };
  // 粗い pass/fail ゲート。null（計測不能）の指標は判定に使わない（Issue #25 仕様）
  const gate = (v) => v === 0 || v === null;
  const pass = gate(metrics.gitleaksLeaks) && gate(metrics.escalation) && gate(metrics.tasksFailed);
  return { pass, reason: null, metrics, projectDir: resolvedProjectDir, artifactDir };
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function updateRepos(record) {
  const file = path.join(ROOT, 'repos.json');
  let existing;
  try { existing = readJson(file); } catch { existing = { repos: [] }; }
  if (!Array.isArray(existing.repos)) existing.repos = [];
  existing.repos = existing.repos.filter((repo) => repo?.id !== record.id);
  existing.repos.push(record);
  fs.writeFileSync(file, `${JSON.stringify(existing, null, 2)}\n`);
}

async function control(baseUrl, pathname, init) {
  let response;
  try { response = await fetch(new URL(pathname, baseUrl), init); }
  catch (error) { throw new Error(`control plane is not running at ${baseUrl} (start: node control.mjs): ${error.message}`); }
  if (!response.ok) throw new Error(`control plane returned HTTP ${response.status} for ${pathname}`);
  try { return await response.json(); }
  catch { throw new Error(`control plane returned invalid JSON for ${pathname}`); }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJob(baseUrl, jobId, timeoutMin) {
  const deadline = Date.now() + timeoutMin * 60_000;
  for (;;) {
    const overview = await control(baseUrl, '/api/control');
    const job = overview.jobs?.find((candidate) => candidate.id === jobId);
    if (job && ['done', 'failed'].includes(job.state)) return job;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for job ${jobId}`);
    await sleep(15_000);
  }
}

function previousResult(themeId) {
  const resultsDir = path.join(ROOT, 'eval', 'results');
  if (!fs.existsSync(resultsDir)) return null;
  const candidates = fs.readdirSync(resultsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try { return readJson(path.join(resultsDir, name)); } catch { return null; }
    })
    .filter((result) => result?.themeId === themeId)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return candidates[0] || null;
}

function comparisonLines(previous, current) {
  if (!previous) return ['baseline'];
  return Object.keys(METRIC_DIRECTIONS).map((metric) => {
    const before = previous.metrics?.[metric];
    const after = current.metrics?.[metric];
    let verdict = 'same';
    if (Number.isFinite(before) && Number.isFinite(after) && before !== after) {
      const isBetter = METRIC_DIRECTIONS[metric] === 'higher' ? after > before : after < before;
      verdict = isBetter ? 'better' : 'worse';
    }
    return `${metric}: ${before ?? 'null'} → ${after ?? 'null'} (${verdict})`;
  });
}

async function run(options) {
  if (options.scoreOnly) {
    const result = scoreProject(options.scoreOnly);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.pass ? 0 : 1;
    return;
  }

  const theme = readJson(path.resolve(options.theme));
  if (!theme || typeof theme.id !== 'string' || typeof theme.theme !== 'string' || typeof theme.stack !== 'string') {
    throw new Error('theme JSON must contain string id, theme, and stack fields');
  }
  const baseUrl = `http://127.0.0.1:${options.port}`;
  await control(baseUrl, '/api/control');

  const ts = stamp();
  const workspace = path.join(ROOT, 'workspaces', `eval-${theme.id}-${ts}`);
  fs.mkdirSync(workspace, { recursive: true }); // workspaces/ 親ごと作成（初回実行で親が無い）
  const git = spawnSync('git', ['-C', workspace, 'init'], { encoding: 'utf8', windowsHide: true });
  if (git.status !== 0) throw new Error(`git init failed: ${(git.stderr || git.error?.message || '').trim()}`);
  const repoId = `eval-${theme.id}-${ts}`;
  updateRepos({ id: repoId, url: '', slug: 'eval', path: workspace, branch: 'main', mode: 'existing', state: 'ready', defaultLane: 'build' });

  const prompt = `/2aio-build ${theme.theme} eval-${ts} --auto --local --stack=${theme.stack}`;
  const enqueued = await control(baseUrl, `/api/enqueue?repo=${encodeURIComponent(repoId)}&kind=build&prompt=${encodeURIComponent(prompt)}`, { method: 'POST' });
  if (!enqueued.ok || !enqueued.job?.id) throw new Error('control plane did not return an enqueued job id');
  const job = await waitForJob(baseUrl, enqueued.job.id, options.timeoutMin);
  const scored = scoreProject(workspace, job);
  const result = {
    at: new Date().toISOString(), themeId: theme.id, theme: theme.theme,
    jobId: job.id, jobState: job.state, pass: scored.pass, metrics: scored.metrics, projectDir: workspace,
  };
  const resultsDir = path.join(ROOT, 'eval', 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const previous = previousResult(theme.id);
  fs.writeFileSync(path.join(resultsDir, `${result.at.replace(/:/g, '-')}.json`), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n${comparisonLines(previous, result).join('\n')}\n`);
  process.exitCode = result.pass ? 0 : 1;
}

// 直接実行時のみ CLI として走る（scoreProject を test から import しても副作用を起こさない）
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
