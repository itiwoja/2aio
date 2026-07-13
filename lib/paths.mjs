// パス解決と安全境界チェック
import path from 'node:path';

import os from 'node:os';

// config.json の paths を repo ルート基準で絶対パス化（絶対パスはそのまま、先頭の ~ はホームに展開）
export function resolvePaths(root, paths) {
  const out = {};
  for (const [k, v] of Object.entries(paths || {})) {
    const expanded = typeof v === 'string' && (v === '~' || v.startsWith('~/') || v.startsWith('~\\'))
      ? path.join(os.homedir(), v.slice(1))
      : v;
    out[k] = path.resolve(root, expanded);
  }
  return out;
}

// p が base 配下（base 自身は含まない）にあるか。承認適用の書き込み先制限に使う。
export function within(p, base) {
  const rel = path.relative(path.resolve(base), path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
