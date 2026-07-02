// パス解決と安全境界チェック
import path from 'node:path';

// config.json の paths を repo ルート基準で絶対パス化（絶対パスはそのまま）
export function resolvePaths(root, paths) {
  const out = {};
  for (const [k, v] of Object.entries(paths || {})) out[k] = path.resolve(root, v);
  return out;
}

// p が base 配下（base 自身は含まない）にあるか。承認適用の書き込み先制限に使う。
export function within(p, base) {
  const rel = path.relative(path.resolve(base), path.resolve(p));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}
