#!/usr/bin/env node
// 2AIOForge — 2AIO自己強化ループ（ローカルLLM主体）
// 収集(Web検索) → 合成(ローカルLLM起草) → 監査(多役クリティック) → 提案/適用 → 記録
// 自動適用は「vault × low × 監査PASS」のみ / skills・高リスク・監査NG・--dry は提案のみ(承認制)
import fs from 'node:fs';
import path from 'node:path';
import { ollamaJSON, ollamaReady, setOllamaUrl } from './lib/ollama.mjs';
import { webSearch, searchBackend } from './lib/search.mjs';
import { applyWithHistory } from './lib/history.mjs';
import { claudeJSON } from './lib/claude.mjs';
import { recordUsage } from './lib/usage.mjs';
import { decideAction } from './lib/policy.mjs';
import { resolvePaths } from './lib/paths.mjs';

let CURRENT_TOPIC = null;
const onUse = (phase) => (u) => recordUsage(ROOT, { topic: CURRENT_TOPIC, phase, ...u });

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
CFG.paths = resolvePaths(ROOT, CFG.paths);
setOllamaUrl(CFG.ollamaUrl);
const STAMP = process.env.AIOFORGE_STAMP || new Date().toISOString().slice(0, 10); // 呼び出し側で固定可
const args = process.argv.slice(2);
const onlyTopic = (args.find(a => a.startsWith('--topic=')) || '').split('=')[1];
const dry = args.includes('--dry'); // 適用せず提案だけ出す

const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });
const log = (...a) => console.log('[2aio]', ...a);

function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

async function collect(topic) {
  const docs = [];
  for (const q of topic.queries) {
    const res = await webSearch(q, { max: CFG.search.maxResults, maxChars: CFG.search.maxCharsPerResult }).catch(e => { log('search err', q, e.message); return []; });
    for (const r of res) docs.push({ q, ...r });
  }
  return docs;
}

function sourcesBlock(docs) {
  return docs.map((d, i) => `[${i + 1}] ${d.title}\n${d.url}\n${d.content}`).join('\n\n').slice(0, 14000);
}

async function synthesize(topic, docs, currentContent) {
  const sys = `あなたは2AIO(Claude向け設計知識ベース)の編集者。与えられたWeb検索結果から、対象ドキュメントに反映すべき"最新かつ確かな"知見だけを抽出し、日本語の更新案を作る。
規則: 出典に無い断定をしない/古い情報や宣伝を除外/簡潔・箇条書き中心/実装に使える具体(数値・トークン・手法)を優先/不確かなものは「要確認」と明記。`;
  const user = `対象: ${topic.id}（種別: ${topic.target.type}）
${currentContent ? `現行ドキュメント(抜粋):\n"""${currentContent.slice(0, 4000)}"""\n` : '(現行ドキュメントなし=新規)\n'}
Web検索結果(出典付き):
"""${sourcesBlock(docs)}"""

JSONで出力: {"summary": "3行要約", "rationale": "提案理由(なぜこの更新が必要か・出典のどこが根拠か[n]・現行との差分の要点を日本語で具体的に)", "updated_markdown": "対象ドキュメントに置く完成Markdown本文(出典[n]を本文末に列挙)", "key_points": ["..."], "uncertainties": ["要確認点"]}`;
  return await ollamaJSON([{ role: 'system', content: sys }, { role: 'user', content: user }], { model: CFG.model, temperature: 0.2, onUsage: onUse('synth') });
}

const ROLE_PROMPT = {
  factuality: '事実性: 出典で裏が取れない断定・誤りを指摘。ただし**版・日付・数値は「出典に書かれた内容」を一次情報として尊重**し、あなた自身の記憶(学習時点が古い可能性がある)で出典の新しい情報を否定しない。「最新版は◯年」等を自分の知識で断定して弾かないこと。指摘は出典同士の矛盾／出典に全く無い捏造のみに限る。',
  hallucination: '幻覚: 出典に全く現れない数値/API/製品名/URL/手法の捏造のみを指摘。出典に書かれていれば、あなたの記憶に無くても捏造扱いしない。',
  '2aio-fit': '2AIO適合: 重複/冗長/既存方針との矛盾、対象種別(skill/vault)に不適切な内容を指摘。',
  safety: '安全性: 危険な助言、秘密情報、ライセンス無視、誤適用リスクを指摘。',
};

// Claude(ヘッドレス)による高品質監査：4観点を1コールに集約・失敗時はローカルにフォールバック
async function auditClaude(topic, draft, docs) {
  const prompt = `あなたは2AIO(設計知識ベース)の厳格な監査役。下の「更新案」を、与えた「出典」のみを根拠に監査する。
重要: 版・日付・数値は出典に書かれた内容を一次情報として尊重し、出典に書いてあれば(あなたの知識に無くても)捏造扱いしない。
観点: 事実性(出典で裏が取れない断定)/幻覚(出典に全く無い捏造)/2AIO適合(重複・矛盾・対象種別[${topic.target.type}]に不適切)/安全(危険助言・秘密・ライセンス無視)。
更新案:
"""${(draft.updated_markdown || '').slice(0, 7000)}"""
出典:
"""${sourcesBlock(docs).slice(0, 8000)}"""
JSONのみで返す: {"pass": true|false, "issues": ["具体的な問題。無ければ空配列"]}`;
  try {
    const v = await claudeJSON(prompt, { timeoutMs: 120000, onUsage: onUse('audit') });
    if (v && typeof v.pass === 'boolean') return { pass: v.pass, issues: v.issues || [], by: 'claude' };
    throw new Error('claude応答不正');
  } catch (e) { log('  claude監査失敗→ローカルにフォールバック:', e.message); return auditLocal(topic, draft, docs); }
}

async function audit(topic, draft, docs) {
  if ((CFG.auditBackend || 'local') === 'claude') return auditClaude(topic, draft, docs);
  return auditLocal(topic, draft, docs);
}

async function auditLocal(topic, draft, docs) {
  // fail-closed: 監査役ゼロ設定で「監査PASS扱い→自動適用」にならないようにする
  if (!Array.isArray(CFG.auditRoles) || !CFG.auditRoles.length) return { pass: false, issues: ['auditRolesが空（監査不能のためNG扱い）'] };
  const issuesAll = [];
  let pass = true;
  for (const role of CFG.auditRoles) {
    const sys = `あなたは厳格な監査役(${role})。${ROLE_PROMPT[role] || ''} 問題が無ければ pass=true。甘く通さないが、**出典に書かれた新しい日付/版/事実を、自分の記憶が古いという理由で誤りにしない**こと。`;
    const user = `対象:${topic.id}\n更新案Markdown:\n"""${(draft.updated_markdown || '').slice(0, 6000)}"""\n出典:\n"""${sourcesBlock(docs).slice(0, 6000)}"""\nJSONで: {"pass": true/false, "issues": ["具体的な問題"], "severity": "low|med|high"}`;
    const v = await ollamaJSON([{ role: 'system', content: sys }, { role: 'user', content: user }], { model: CFG.model, temperature: 0, onUsage: onUse('audit') });
    const ok = v?.pass === true;
    if (!ok) { pass = false; (v?.issues || ['(監査応答不正)']).forEach(i => issuesAll.push(`[${role}] ${i}`)); }
  }
  return { pass, issues: issuesAll };
}

async function revise(topic, draft, issues, docs) {
  const sys = 'あなたは2AIOの編集者。監査の指摘を反映して更新案Markdownを修正する。指摘された箇所のみ直し、出典に無い情報は足さない。';
  const user = `現行更新案:\n"""${draft.updated_markdown || ''}"""\n監査の指摘:\n- ${issues.join('\n- ')}\n出典:\n"""${sourcesBlock(docs).slice(0, 6000)}"""\nJSONで: {"summary":"...","rationale":"提案理由(指摘反映後)","updated_markdown":"修正後の完成Markdown","key_points":["..."],"uncertainties":["..."]}`;
  return await ollamaJSON([{ role: 'system', content: sys }, { role: 'user', content: user }], { model: CFG.model, temperature: 0.2, onUsage: onUse('revise') });
}

function targetPath(topic) {
  if (topic.target.type === 'vault') return path.join(CFG.paths.vault, topic.target.file);
  if (topic.target.type === 'skill') return path.join(CFG.paths.skills, topic.target.name, 'SKILL.md');
  throw new Error('unknown target type');
}

function vaultContent(topic, draft) {
  const header = `<!-- 2AIOForge 自動生成 ${STAMP} / backend:${searchBackend()} / model:${CFG.model} -->\n# ${topic.id}（自動収集ナレッジ）\n\n> 2AIOForgeが収集→合成→監査PASSした最新知見。低リスクvaultのため自動適用。出典は本文末。\n\n`;
  return header + (draft.updated_markdown || '');
}

function proposeChange(topic, draft, audit, why) {
  ensureDir(CFG.paths.proposals);
  const p = path.join(CFG.paths.proposals, `${STAMP}_${topic.id}.md`);
  const cur = read(targetPath(topic));
  const body = `# 提案: ${topic.id} → ${topic.target.type === 'skill' ? 'skill:' + topic.target.name : topic.target.file}
- 生成: ${STAMP} / 検索:${searchBackend()} / model:${CFG.model}
- リスク: ${topic.risk}
- 提案扱いの理由: ${why || '承認制（自動適用しない）'}
- 監査: ${audit.pass ? 'PASS' : 'ISSUES: ' + audit.issues.join(' / ')}

## 要約
${draft.summary || ''}

## 提案理由（なぜこの更新を出すのか）
${draft.rationale || '(理由の生成なし)'}

## 要確認
${(draft.uncertainties || []).map(u => '- ' + u).join('\n') || '- なし'}

## 提案する更新内容（このまま採用 or 編集して反映）
\`\`\`markdown
${draft.updated_markdown || ''}
\`\`\`

## 現行（参考・先頭2000字）
\`\`\`
${cur.slice(0, 2000)}
\`\`\`

---
承認するなら: この内容で対象ファイルを更新（人 or Claude が判断）。`;
  fs.writeFileSync(p, body);
  // 承認時に確実に適用できるよう機械可読サイドカーも残す
  fs.writeFileSync(p.replace(/\.md$/, '.json'), JSON.stringify({
    id: topic.id, targetType: topic.target.type, target: topic.target,
    targetPath: targetPath(topic), risk: topic.risk, stamp: STAMP, why: why || '',
    summary: draft.summary, rationale: draft.rationale, content: draft.updated_markdown, audit,
  }, null, 2));
  return p;
}

async function runTopic(topic) {
  CURRENT_TOPIC = topic.id;
  log(`▶ ${topic.id} (${topic.target.type}/${topic.risk})`);
  const docs = await collect(topic);
  log(`  収集: ${docs.length}件`);
  if (!docs.length) return { topic: topic.id, status: 'no-sources' };

  const current = read(targetPath(topic));
  let draft = await synthesize(topic, docs, current);
  if (!draft?.updated_markdown) return { topic: topic.id, status: 'synth-failed' };

  let a = await audit(topic, draft, docs);
  let round = 0;
  while (!a.pass && round < CFG.auditRounds) {
    round++; log(`  監査NG→改稿 round ${round}: ${a.issues.slice(0, 2).join(' | ')}`);
    const rev = await revise(topic, draft, a.issues, docs);
    if (rev?.updated_markdown) draft = rev;
    a = await audit(topic, draft, docs);
  }
  log(`  監査: ${a.pass ? 'PASS' : 'NG(' + a.issues.length + ')'}`);

  // 安全分岐（README仕様）: vault × low × 監査PASS のみ自動適用。それ以外は全て提案（承認制）。
  const { action, why } = decideAction({ targetType: topic.target.type, risk: topic.risk, auditPass: a.pass, dry });
  if (action === 'propose') {
    const p = proposeChange(topic, draft, a, why);
    log(`  📝 提案のみ: ${p}（${why}）`);
    return { topic: topic.id, status: 'proposed', why, round, proposal: p, sources: docs.length, audit: a };
  }
  const meta = {
    topic: topic.id, targetType: topic.target.type,
    targetDisplay: topic.target.type === 'skill' ? 'skill:' + topic.target.name : topic.target.file,
    reason: draft.rationale || draft.summary || '', auditPass: a.pass, auditIssues: a.issues, sources: docs.length,
  };
  // 適用時も毎回バックアップ＋履歴に記録（あとで巻き戻せる）
  const rec = applyWithHistory(ROOT, targetPath(topic), vaultContent(topic, draft), meta);
  log(`  ✅ 自動適用: ${rec.targetPath} (監査OK / 履歴 ${rec.id})`);
  return { topic: topic.id, status: 'applied', round, applied: rec.targetPath, historyId: rec.id, sources: docs.length, audit: a };
}

(async () => {
  log(`start ${STAMP} / 検索:${searchBackend()} / model:${CFG.model}`);
  if (!await ollamaReady(CFG.model)) { log('❌ Ollama未起動 or モデル無し:', CFG.model); process.exit(2); }
  const topics = CFG.topics.filter(t => !onlyTopic || t.id === onlyTopic);
  const results = [];
  for (const t of topics) { try { results.push(await runTopic(t)); } catch (e) { log('topic err', t.id, e.message); results.push({ topic: t.id, status: 'error', error: e.message }); } }
  ensureDir(CFG.paths.runs);
  const runPath = path.join(CFG.paths.runs, `${STAMP}.json`);
  fs.writeFileSync(runPath, JSON.stringify({ stamp: STAMP, backend: searchBackend(), model: CFG.model, results }, null, 2));
  log('done →', runPath);
  log('summary:', results.map(r => `${r.topic}:${r.status}`).join(' | '));
})();
