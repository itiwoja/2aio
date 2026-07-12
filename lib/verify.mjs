import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
