// Ring-4 スキル整合スキャナ（Wave C）。Hermes tools/skills_guard.py の概念borrow（MIT）。
// 依存ゼロ・オフラインで vendored スキルの供給網リスク（exfil / 破壊 / 永続化 / 難読化 /
// prompt-injection）をパターン検査する。README が薦める外部ツール（SkillSpector/SkilLock, Docker 要）
// の「常時 CI 可能なネイティブ下地」= Ring-4 を README から実装へ格上げする第一段。
//
// 誤検知回避の要: スクリプトファイルはシェル脅威、Markdown 等の文書は prompt-injection のみを見る
// （チュートリアルの正当な `curl|bash` / `rm -rf` 例を脅威と誤らないため）。report-first。
import fs from 'node:fs';
import path from 'node:path';

export const SEVERITY = { critical: 3, high: 2, medium: 1, info: 0 };
const SCRIPT_EXT = new Set(['.sh', '.bash', '.zsh', '.py', '.mjs', '.cjs', '.js', '.ps1', '.rb', '.pl']);
// 走査対象にするテキスト拡張子（バイナリ/巨大アセットは無視）。
const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', ...SCRIPT_EXT]);

// スクリプト内のシェル脅威。
const SCRIPT_RULES = [
  { category: 'exfil', severity: 'critical', re: /\b(curl|wget)\b[^\n|]*\|\s*(sudo\s+)?(bash|sh|zsh|python[0-9.]*)\b/i, note: 'download-and-execute (curl|bash)' },
  { category: 'exfil', severity: 'critical', re: /\bbase64\b[^\n|]*-d[^\n|]*\|\s*(bash|sh|zsh)\b/i, note: 'base64 decode piped to shell' },
  { category: 'egress', severity: 'high', re: /\/dev\/tcp\/|\b(nc|netcat)\b[^\n]*\s-e\b/i, note: 'reverse shell / raw socket' },
  { category: 'exfil', severity: 'high', re: /\bInvoke-Expression\b|\biex\b\s*\(/i, note: 'PowerShell iex' },
  { category: 'destructive', severity: 'critical', re: /\brm\s+-rf?\s+(\/(?!tmp)|~|\$HOME|\$\{?HOME)/i, note: 'rm -rf on home/root' },
  { category: 'destructive', severity: 'critical', re: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, note: 'fork bomb' },
  { category: 'destructive', severity: 'high', re: /\bdd\b[^\n]*\bof=\/dev\/(sd|nvme|disk|hd)/i, note: 'dd to raw disk' },
  { category: 'persistence', severity: 'high', re: /\bcrontab\b|\bsystemctl\s+enable\b|\blaunchctl\s+load\b|authorized_keys|>>?\s*~?\/?\.(bashrc|zshrc|bash_profile|profile)\b/i, note: 'persistence write' },
  { category: 'credential', severity: 'high', re: /\b(cat|cp|tar|base64|scp|curl)\b[^\n]*(\.ssh\/id_|\.aws\/credentials|\/\.env\b)/i, note: 'reads/copies credentials' },
  { category: 'obfuscation', severity: 'medium', re: /\beval\s*\(?\s*(atob|base64|Buffer\.from|decode|fromCharCode)/i, note: 'eval of decoded content' },
];

// 全文（Markdown 含む）で見る prompt-injection / promptware / 埋め込み秘密流出指示。
// prose:true のルールは散文に出やすく、防御的文脈（後述 DEFENSIVE_HINT）では抑制する。
const TEXT_RULES = [
  { category: 'injection', severity: 'high', prose: true, re: /ignore\s+(all\s+|any\s+)?(the\s+|your\s+)?previous\s+(instructions|messages|context)/i, note: 'ignore previous instructions' },
  { category: 'injection', severity: 'high', prose: true, re: /disregard\s+(the\s+|all\s+|your\s+)?(system|previous|prior)\s+(prompt|instructions|rules)/i, note: 'disregard system prompt' },
  { category: 'injection', severity: 'high', prose: true, re: /\byou\s+are\s+now\s+(dan\b|in\s+developer\s+mode|unrestricted|jailbroken)/i, note: 'jailbreak persona' },
  { category: 'injection', severity: 'high', re: /<\|im_(start|end)\|>|\[\/?INST\]/i, note: 'chat-template injection token' }, // トークンは散文に出ないので無ガード
  { category: 'exfil', severity: 'high', prose: true, re: /\bexfiltrat\w*\s+(the\s+|your\s+|all\s+|of\s+)?(\w+\s+)?(secrets?|credentials?|env(?:ironment)?|data|api[_-]?keys?|keys?|tokens?|files?)\b|\bsend\s+(the\s+|your\s+)?(secrets?|credentials?|env(?:ironment)?|api[_-]?keys?|tokens?)\s+(to|via)\b/i, note: 'exfiltration instruction' },
  { category: 'obfuscation', severity: 'medium', re: /[A-Za-z0-9+/]{240,}={0,2}/, note: 'long base64 blob' },
];

// 防御的/引用的文脈のヒント。同一行にこれがあると、injection/exfil の語彙は「攻撃を説明・
// 拒否する解説」（防御セキュリティ skill 特有）とみなし prose:true ルールを抑制する。
// report-first の低ノイズ化が狙いで、AV 的網羅性は SCRIPT_RULES と provenance が担う。
const DEFENSIVE_HINT = /\bnever\b|\bdo\s+not\b|\bdon't\b|\bavoid\b|\bmust\s+not\b|\bcannot\b|\bcan't\b|\breject\b|\brefuse\b|\btreat\s+it\s+as\s+data\b|\bflags?\b|\bsurface\s+it\b|\bnot\s+(to\s+)?(interpret|execute|run|follow)\b/i;

/** 1 本のテキストを走査して findings を返す。isScript でシェル脅威ルールを足す。 */
export function scanContent(text, { isScript = false } = {}) {
  const findings = [];
  const rules = isScript ? [...SCRIPT_RULES, ...TEXT_RULES] : TEXT_RULES;
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const defensive = DEFENSIVE_HINT.test(lines[i]);
    for (const rule of rules) {
      if (rule.prose && defensive) continue; // 防御的文脈では散文ルールを抑制
      if (rule.re.test(lines[i])) {
        findings.push({ category: rule.category, severity: rule.severity, note: rule.note, line: i + 1, snippet: lines[i].trim().slice(0, 120) });
      }
    }
  }
  return findings;
}

function walk(dir) {
  const out = [];
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

const MAX_BYTES = 512 * 1024; // これを超えるファイルはスキップ（生成アセット等）

/** スキルディレクトリを走査。findings（file 相対パス付き）と最大 severity を返す。 */
export function scanSkillDir(dir) {
  const findings = [];
  for (const file of walk(dir)) {
    let text;
    try { if (fs.statSync(file).size > MAX_BYTES) continue; text = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const isScript = SCRIPT_EXT.has(path.extname(file).toLowerCase());
    for (const f of scanContent(text, { isScript })) findings.push({ ...f, file: path.relative(dir, file) });
  }
  let maxSeverity = 'info';
  for (const f of findings) if (SEVERITY[f.severity] > SEVERITY[maxSeverity]) maxSeverity = f.severity;
  return { findings, maxSeverity };
}

// 信頼できると明示的に許可した upstream owner（SOURCES.md 由来。必要に応じて足す）。
const TRUSTED_OWNERS = new Set(['anthropics', 'anthropic-experimental', 'openai', 'nvidia', 'huggingface', 'addyosmani', 'dimillian']);

/** SOURCE.md の本文から provenance 信頼度を分類する。無ければ 'unknown'（vendored 集合での無出典は赤信号）。 */
export function classifyTrust(sourceText) {
  if (!sourceText || !String(sourceText).trim()) return 'unknown';
  const m = String(sourceText).match(/github\.com\/([^/\s\])]+)/i);
  if (!m) return 'community';
  return TRUSTED_OWNERS.has(m[1].toLowerCase()) ? 'trusted' : 'community';
}

/** trust × 最大 severity → 'allow' | 'warn' | 'block'。無出典・低信頼ほど厳しく。 */
export function decidePolicy(trust, maxSeverity) {
  const s = SEVERITY[maxSeverity] ?? 0;
  if (s >= SEVERITY.critical) return 'block';                    // critical は信頼に関係なくブロック
  if (s >= SEVERITY.high) return trust === 'trusted' ? 'warn' : 'block';
  if (s >= SEVERITY.medium) return 'warn';
  return 'allow';
}
