import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns/promises';

const CODE_FENCE = /^```([^\r\n`]*)[^\r\n]*\r?\n([\s\S]*?)^```\s*$/gm;
const URL = /https?:\/\/[^\s<>()\[\]{}"'`]+/g;

function syntaxError(fenceNumber, language, detail) {
  return `コードフェンス#${fenceNumber} (${language}) 構文エラー: ${detail}`;
}

function checkJavaScript(source, fenceNumber, issues) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '2aio-verify-'));
  const filename = path.join(directory, 'fence.mjs');

  try {
    fs.writeFileSync(filename, source, 'utf8');
    const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
    if (result.status !== 0) {
      const detail = String(result.stderr || result.error?.message || 'node --check failed').slice(0, 120);
      issues.push(syntaxError(fenceNumber, 'js', detail));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function checkCodeFences(markdown, issues) {
  let fenceNumber = 0;

  for (const match of markdown.matchAll(CODE_FENCE)) {
    fenceNumber += 1;
    const language = match[1].trim().toLowerCase().split(/\s+/, 1)[0];
    const source = match[2];

    if (language === 'js' || language === 'javascript' || language === 'mjs') {
      checkJavaScript(source, fenceNumber, issues);
    } else if (language === 'json') {
      try {
        JSON.parse(source);
      } catch (error) {
        issues.push(syntaxError(fenceNumber, 'json', String(error.message).slice(0, 120)));
      }
    }
  }
}

function markdownUrls(markdown) {
  const urls = [];
  const seen = new Set();

  for (const rawUrl of markdown.match(URL) || []) {
    const url = rawUrl.replace(/[.,;:!?]+$/, '');
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
      if (urls.length === 10) break;
    }
  }

  return urls;
}

// SSRF ガード: verifyDraft は LLM 合成 markdown 中の URL（第三者が内容を操作しうる）へ fetch する。
// プライベート/ループバック/リンクローカル/メタデータ宛先を弾き、内部ネットワーク到達・簡易ポートスキャンを防ぐ。
// ベストエフォート（DNS リバインドまでは防がないが、本関数は本文を返さず status のみ返すため残存リスクは限定的）。
function isPrivateIp(ip) {
  const v = ip.replace(/^::ffff:/i, ''); // IPv4-mapped IPv6 を素の IPv4 として扱う
  if (net.isIPv4(v)) {
    const [a, b] = v.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    return low === '::1' || low === '::' || low.startsWith('fe80') || low.startsWith('fc') || low.startsWith('fd');
  }
  return false;
}

async function assertPublicUrl(url) {
  let host;
  try { host = new globalThis.URL(url).hostname; } catch { throw new Error('URL 解析不可'); }
  const bare = host.replace(/^\[|\]$/g, ''); // IPv6 リテラル [::1] のブラケット除去
  if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('内部ホスト拒否');
  if (net.isIP(bare)) {
    if (isPrivateIp(bare)) throw new Error('内部IP拒否');
    return;
  }
  let addrs;
  try { addrs = await dns.lookup(host, { all: true }); } catch { return; } // 解決不能は fetch 側の生存確認NGに委ねる
  for (const { address } of addrs) if (isPrivateIp(address)) throw new Error('内部IPに解決されるホスト拒否');
}

async function fetchStatus(url, method) {
  const response = await fetch(url, {
    method,
    signal: AbortSignal.timeout(8_000),
  });

  if (method === 'GET') await response.arrayBuffer();
  return response.status;
}

async function checkUrl(url, uncertainties) {
  let status;

  try {
    await assertPublicUrl(url);
  } catch (error) {
    uncertainties.push(`URL 検証スキップ（内部宛先の可能性）: ${url}（${error.message}）`);
    return;
  }

  try {
    status = await fetchStatus(url, 'HEAD');
    if (status >= 200 && status < 400) return;
    if (status === 404) {
      uncertainties.push(`URL 生存確認 NG: ${url}（${status}）`);
      return;
    }
  } catch {
    // A failed HEAD request gets the same GET fallback as a rejected HEAD request.
  }

  try {
    status = await fetchStatus(url, 'GET');
    if (status >= 200 && status < 400) return;
    uncertainties.push(`URL 生存確認 NG: ${url}（${status}）`);
  } catch (error) {
    uncertainties.push(`URL 生存確認 NG: ${url}（${error.message}）`);
  }
}

// markdown 中のコードフェンスと URL を決定的に検証する
export async function verifyDraft(markdown) {
  const text = String(markdown ?? '');
  const issues = [];
  const uncertainties = [];

  checkCodeFences(text, issues);
  await Promise.all(markdownUrls(text).map((url) => checkUrl(url, uncertainties)));

  return { issues, uncertainties };
}
