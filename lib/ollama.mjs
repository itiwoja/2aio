// ローカルLLM(Ollama)呼び出しヘルパ
// 優先順: OLLAMA_URL 環境変数 > setOllamaUrl(config.jsonのollamaUrl) > localhost既定
let OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
export function setOllamaUrl(url) {
  if (url && !process.env.OLLAMA_URL) OLLAMA = url;
}

export async function ollamaChat(messages, { model = 'qwen2.5-coder:7b', format = null, temperature = 0.2, timeoutMs = 300000, onUsage = null } = {}) {
  const body = { model, messages, stream: false, options: { temperature } };
  if (format) body.format = format; // 'json' で JSON モード
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`ollama ${r.status} ${await r.text().catch(() => '')}`);
    const j = await r.json();
    if (onUsage) onUsage({ backend: 'ollama', model, inTok: j.prompt_eval_count || 0, outTok: j.eval_count || 0 });
    return j.message?.content || '';
  } finally { clearTimeout(t); }
}

// JSON を要求して安全にパース（コードフェンス/前後ノイズ除去つき）
export async function ollamaJSON(messages, opts = {}) {
  const txt = await ollamaChat(messages, { ...opts, format: 'json' });
  try { return JSON.parse(txt); } catch {}
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

export async function ollamaReady(model) {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return false;
    const j = await r.json();
    const names = (j.models || []).map(m => m.name);
    return model ? names.includes(model) : names.length > 0;
  } catch { return false; }
}
