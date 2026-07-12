// リポジトリ登録: HTTPS(またはSSH)のGit URLを解析し、cloneした作業ツリーが「新規」か「既存」かを判定する。
import fs from 'node:fs';
import path from 'node:path';

// https://host/owner/name(.git) と git@host:owner/name(.git) を解析。失敗時 null。
export function parseRepoUrl(url) {
  const s = String(url || '').trim();
  let m = s.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) m = s.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  const [, host, owner, name] = m;
  return { host, owner, name, slug: `${owner}/${name}` };
}

// README/LICENSE/.gitignore 等の定型ファイルは「中身なし」とみなす対象。
const BOILERPLATE = new Set(['readme', 'readme.md', 'readme.txt', 'license', 'license.md', 'license.txt', '.gitignore', '.gitattributes', 'code_of_conduct.md', 'contributing.md']);
const CODE_RE = /\.(m?[jt]sx?|py|go|rs|java|rb|php|c|cc|cpp|cs|kt|swift|vue|svelte|html?|css|scss|sql|sh|ps1|mjs|cjs)$/i;

// dir 直下～数階層を走査(.git/node_modules除外・件数上限)して new/existing を判定。
// #11: あわせて言語・テスト/ビルドコマンドを検出して返す（毎ジョブのゼロ知識読み直しを減らす）。
export function classifyRepo(dir, { maxFiles = 2000 } = {}) {
  let files = [];
  try { files = walk(dir, maxFiles); } catch { return { mode: 'new', fileCount: 0, codeCount: 0, stack: null }; }
  const meaningful = files.filter(f => !BOILERPLATE.has(path.basename(f).toLowerCase()));
  const codeCount = files.filter(f => CODE_RE.test(f)).length;
  // コードが1つも無い or 定型ファイルしか無い → 新規(これから作る)
  const mode = (codeCount === 0 || meaningful.length === 0) ? 'new' : 'existing';
  return { mode, fileCount: files.length, codeCount, stack: detectStack(dir) };
}

// #11: スタック検出（決定論・軽量）。package.json scripts / 定番ファイルからテスト・ビルドコマンドを拾う。
export function detectStack(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch { /* not npm */ }
  if (pkg) {
    const s = pkg.scripts || {};
    return {
      language: 'javascript',
      testCmd: s.test && !/no test specified/.test(s.test) ? 'npm test' : null,
      buildCmd: s.build ? 'npm run build' : null,
      lintCmd: s.lint ? 'npm run lint' : null,
    };
  }
  if (has('pyproject.toml') || has('requirements.txt')) {
    return { language: 'python', testCmd: has('pytest.ini') || has('pyproject.toml') ? 'pytest' : null, buildCmd: null, lintCmd: null };
  }
  if (has('go.mod')) return { language: 'go', testCmd: 'go test ./...', buildCmd: 'go build ./...', lintCmd: 'go vet ./...' };
  if (has('Cargo.toml')) return { language: 'rust', testCmd: 'cargo test', buildCmd: 'cargo build', lintCmd: 'cargo clippy' };
  return null;
}

function walk(dir, cap) {
  const out = [];
  const stack = [dir];
  const SKIP = new Set(['.git', 'node_modules', '.next', 'dist', 'build', '.venv', '__pycache__']);
  while (stack.length && out.length < cap) {
    const d = stack.pop();
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (SKIP.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else out.push(p);
      if (out.length >= cap) break;
    }
  }
  return out;
}
