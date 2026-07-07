// Web検索: Tavily(キーあり優先) → DuckDuckGo HTML(キーレス・フォールバック)
const stripTags = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

async function tavily(query, max) {
  const key = process.env.TAVILY_API_KEY;
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: key, query, max_results: max, include_raw_content: true, search_depth: 'basic' }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`tavily ${r.status}`);
  const j = await r.json();
  return (j.results || []).map(x => ({ title: x.title, url: x.url, content: x.raw_content || x.content || '' }));
}

async function ddg(query, max) {
  // キーレス・フォールバック（HTML スクレイプ。脆いが鍵不要で自律運用可）
  const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) CCCForge/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  const html = await r.text();
  const out = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = re.exec(html)) && out.length < max) {
    let url = m[1];
    const um = url.match(/uddg=([^&]+)/); if (um) url = decodeURIComponent(um[1]);
    out.push({ title: stripTags(m[2]), url, content: stripTags(m[3] || '') });
  }
  return out;
}

export async function webSearch(query, { max = 5, maxChars = 1800 } = {}) {
  let results;
  const via = process.env.TAVILY_API_KEY ? 'tavily' : 'ddg';
  try { results = via === 'tavily' ? await tavily(query, max) : await ddg(query, max); }
  catch (e) { // Tavily 失敗時も DDG に落ちる
    if (via === 'tavily') results = await ddg(query, max).catch(() => []);
    else throw e;
  }
  return (results || []).map(x => ({ ...x, content: (x.content || '').slice(0, maxChars) })).filter(x => x.url);
}

export const searchBackend = () => (process.env.TAVILY_API_KEY ? 'tavily' : 'duckduckgo(keyless)');
