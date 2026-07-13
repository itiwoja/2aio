// Linear の Issue を 2AIO のジョブへ取り込むための小さなアダプター。
// HTTP はグローバルの fetch だけに依存し、ファイル操作は同期 API に限定する。
import fs from 'node:fs';
import path from 'node:path';

const LINEAR_ENDPOINT = 'https://api.linear.app/graphql';
const VALID_KINDS = new Set(['build', 'start', 'plan', 'implement', 'analyze']);

function labelNames(issue) {
  const labels = issue?.labels?.nodes ?? issue?.labels ?? [];
  return labels.map((label) => typeof label === 'string' ? label : label?.name).filter(Boolean);
}

function repoList(repos) {
  return Array.isArray(repos) ? repos : repos?.repos ?? [];
}

function controlComment(jobId, text) {
  return `[2aio-control job:${jobId}] ${text}`;
}

export function mapIssueToJob(issue, repos) {
  const labels = labelNames(issue);
  const registered = repoList(repos).map((entry) => entry.id).filter(Boolean).join(', ') || 'なし';
  const repoLabel = labels.find((label) => label.startsWith('repo:'));
  if (!repoLabel) {
    return { ok: false, reason: 'no-repo', comment: `repo:<slug> ラベルを付けてください（登録済み: ${registered}）。` };
  }

  const slug = repoLabel.slice('repo:'.length).trim();
  const repo = repoList(repos).find((entry) => entry.id === slug);
  if (!slug || !repo) {
    return { ok: false, reason: 'unknown-repo', comment: `repo:${slug || '<slug>'} は登録されていません。repo:<slug> ラベルを付けてください（登録済み: ${registered}）。` };
  }

  const kindLabel = labels.find((label) => label.startsWith('kind:'));
  const kind = kindLabel?.slice('kind:'.length).trim();
  if (!kind || !VALID_KINDS.has(kind)) {
    return { ok: false, reason: 'no-kind', comment: 'kind:build|start|plan|implement|analyze ラベルを付けてください。' };
  }

  return {
    ok: true,
    job: {
      repo: repo.id,
      kind,
      args: {
        theme: issue?.title ?? '',
        detail: String(issue?.description ?? '').slice(0, 500),
        linearIssueId: issue?.id,
        linearIdentifier: issue?.identifier,
      },
    },
  };
}

export function filterUnseen(issues, seen) {
  const ids = new Set(seen?.ids ?? []);
  return (issues ?? []).filter((issue) => !ids.has(issue.id));
}

export function finalizeAction({ exit, failReason, jobId, completion }) {
  if (exit !== 0) {
    return { state: 'Todo', comment: controlComment(jobId, `実行に失敗しました: ${failReason || '不明なエラー'}`) };
  }
  if (completion?.completed) {
    return { state: 'Done', comment: controlComment(jobId, `実装が完了しました: ${completion.summary || 'completion-report を確認してください。'}`) };
  }
  return { state: null, comment: controlComment(jobId, '実行は終了しましたが、completion-report で完了を確認できませんでした。') };
}

// since(ISO/epoch ms) を渡すと、それ以降に更新された成果物だけを完了と認める
// （過去プロジェクトの古い completion-report による誤 Done を防ぐ — 修正条件1の趣旨）。
export function detectCompletion(repoPath, since = null) {
  const sinceMs = since == null ? null : (typeof since === 'number' ? since : Date.parse(since));
  const freshEnough = (file) => {
    if (sinceMs == null || Number.isNaN(sinceMs)) return true;
    try { return fs.statSync(file).mtimeMs >= sinceMs; } catch { return false; }
  };
  const outputDir = path.join(repoPath, 'output');
  let candidates;
  try {
    candidates = fs.readdirSync(outputDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const dir = path.join(outputDir, entry.name);
        return { dir, mtimeMs: fs.statSync(dir).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return { completed: false };
  }
  if (!candidates.length) return { completed: false };

  for (const { dir } of candidates) {
    const reportPath = path.join(dir, 'completion-report.md');
    if (fs.existsSync(reportPath) && freshEnough(reportPath)) {
      return { completed: true, summary: fs.readFileSync(reportPath, 'utf8').slice(0, 400), reportPath };
    }
    try {
      const statePath = path.join(dir, 'state.md');
      const state = fs.readFileSync(statePath, 'utf8');
      if (/^phase:\s*completed\s*$/mi.test(state) && freshEnough(statePath)) return { completed: true };
    } catch { /* state.md が無ければ次の出力を確認する */ }
  }
  return { completed: false };
}

const seenFile = (root) => path.join(root, 'control', 'linear-seen.json');

export function loadSeen(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(seenFile(root), 'utf8'));
    return { ids: Array.isArray(parsed.ids) ? parsed.ids : [] };
  } catch {
    return { ids: [] };
  }
}

export function saveSeen(root, seen) {
  const file = seenFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ids = Array.from(new Set((seen?.ids ?? []).filter((id) => id != null))).slice(-500);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ids }, null, 2));
  fs.renameSync(tmp, file);
}

async function gql(apiKey, query, variables) {
  const response = await fetch(LINEAR_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Linear API リクエストに失敗しました: HTTP ${response.status}`);
  const body = await response.json();
  if (body.errors?.length) throw new Error(`Linear API エラー: ${body.errors.map((error) => error.message).join('; ')}`);
  return body.data;
}

const AUTO_ISSUES_QUERY = `query($filter: IssueFilter) {
  issues(filter: $filter, first: 20) {
    nodes { id identifier title description state { type } labels { nodes { name } } team { id } }
  }
}`;

export async function fetchAutoIssues(apiKey, label) {
  try {
    const data = await gql(apiKey, AUTO_ISSUES_QUERY, {
      filter: {
        labels: { name: { eq: label } },
        state: { type: { in: ['unstarted', 'backlog'] } },
      },
    });
    const issues = (data?.issues?.nodes ?? []).map((issue) => ({ ...issue, labels: labelNames(issue) }));
    return { ok: true, issues };
  } catch (error) {
    return { ok: false, err: error.message };
  }
}

export async function moveIssueState(apiKey, issueId, stateName) {
  try {
    const issueData = await gql(apiKey, 'query($id: String!) { issue(id: $id) { team { id } } }', { id: issueId });
    const teamId = issueData?.issue?.team?.id;
    if (!teamId) throw new Error('Linear Issue のチームが見つかりません。');
    const statesData = await gql(apiKey, 'query($teamId: String!) { team(id: $teamId) { states { nodes { id name } } } }', { teamId });
    const state = statesData?.team?.states?.nodes?.find((item) => item.name === stateName);
    if (!state) throw new Error(`Linear workflow state が見つかりません: ${stateName}`);
    const result = await gql(apiKey, 'mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }', { id: issueId, stateId: state.id });
    return result?.issueUpdate?.success ? { ok: true } : { ok: false, err: 'Linear Issue の状態更新に失敗しました。' };
  } catch (error) {
    return { ok: false, err: error.message };
  }
}

export async function commentOnIssue(apiKey, issueId, body) {
  try {
    const result = await gql(apiKey, 'mutation($id: String!, $body: String!) { commentCreate(input: { issueId: $id, body: $body }) { success } }', { id: issueId, body });
    return result?.commentCreate?.success ? { ok: true } : { ok: false, err: 'Linear コメントの投稿に失敗しました。' };
  } catch (error) {
    return { ok: false, err: error.message };
  }
}
