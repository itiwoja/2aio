import fs from 'node:fs';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Evaluate a source-file HTML template exactly as its server does, then return
 * its one inline client script.  This keeps client syntax tests coupled to the
 * bytes that are actually served instead of a hand-copied fixture.
 */
export function extractServedScript(sourcePath, { templateVar = 'HTML', args = {} } = {}) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  // バッククォートを含む正規表現はテンプレートリテラルで書けないため文字列連結で構築する
  const template = new RegExp('const\\s+' + escapeRegExp(templateVar) + '\\s*=\\s*`([\\s\\S]*)`;\\s*$');
  const match = source.match(template);
  if (!match) throw new Error(`${templateVar} template was not found in ${sourcePath}`);

  const names = Object.keys(args);
  const values = Object.values(args);
  const served = new Function(...names, 'return `' + match[1] + '`')(...values);
  const scripts = [...served.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) throw new Error(`expected exactly one inline <script> in ${sourcePath}; found ${scripts.length}`);
  return scripts[0][1];
}
