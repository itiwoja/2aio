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
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) 2AIOForge/1.0' },
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

// ── #20 第2弾: 一次ソースアダプタ ──────────────────────────────────
// DDG スニペット断片ではリリースノートの正確な版・移行手順が取れないため、
// GitHub Releases API / npm registry を直接叩く。鍵不要（GitHub は未認証60req/h で足りる）。
// GHSA (GitHub Advisory API) は後続対応。

// topic.primary の1エントリ {type:'github-releases', repo:'vercel/next.js'} → docs 配列
export async function githubReleases(repo, { max = 3, maxChars = 1800 } = {}) {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=${max}`, {
    headers: { 'user-agent': '2AIOForge/1.0', accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`github releases ${repo} ${r.status}`);
  const j = await r.json();
  return (Array.isArray(j) ? j : []).map(rel => ({
    title: `${repo} ${rel.tag_name}${rel.name && rel.name !== rel.tag_name ? ` — ${rel.name}` : ''}（${(rel.published_at || '').slice(0, 10)}）`,
    url: rel.html_url,
    content: String(rel.body || '').slice(0, maxChars),
  }));
}

// {type:'npm', name:'vite'} → 最新版・dist-tags・deprecation を1 doc に
export async function npmPackage(name, { maxChars = 1800 } = {}) {
  const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { 'user-agent': '2AIOForge/1.0' }, signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`npm registry ${name} ${r.status}`);
  const j = await r.json();
  const latest = j['dist-tags']?.latest;
  const ver = latest ? j.versions?.[latest] : null;
  const lines = [
    `latest: ${latest || '不明'}（${(j.time?.[latest] || '').slice(0, 10)}）`,
    `dist-tags: ${JSON.stringify(j['dist-tags'] || {})}`,
    ver?.deprecated ? `DEPRECATED: ${ver.deprecated}` : null,
    ver?.engines ? `engines: ${JSON.stringify(ver.engines)}` : null,
  ].filter(Boolean);
  return [{ title: `npm: ${name}`, url: `https://www.npmjs.com/package/${name}`, content: lines.join('\n').slice(0, maxChars) }];
}

// topic.primary 配列を順に解決（失敗したエントリはスキップして継続 — 一次ソース欠落で全体を止めない）
export async function primarySources(primary = [], opts = {}) {
  const docs = [];
  for (const p of primary) {
    try {
      if (p.type === 'github-releases' && p.repo) docs.push(...await githubReleases(p.repo, opts));
      else if (p.type === 'npm' && p.name) docs.push(...await npmPackage(p.name, opts));
    } catch { /* 個別失敗はスキップ（webSearch が補完する） */ }
  }
  return docs;
}
