import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

function write(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2aio-install-'));
  roots.push(root);
  const repo = path.join(root, 'repo');
  const claudeDir = path.join(root, 'claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const source = fs.readFileSync(new URL('../install.sh', import.meta.url), 'utf8');
  write(path.join(repo, 'install.sh'), source);
  fs.chmodSync(path.join(repo, 'install.sh'), 0o755);
  write(path.join(repo, 'agents', 'agent.md'), 'agent');
  write(path.join(repo, 'commands', '2aio-create.md'), 'create');
  write(path.join(repo, 'commands', '2aio-check.md'), 'check');
  write(path.join(repo, 'lanes', '2aio-build.md'), 'build lane');
  write(path.join(repo, 'skills', 'test', 'skill-a', 'SKILL.md'), 'skill');
  return { repo, claudeDir };
}

test('installer syncs new public commands and lanes, removes only retired 2aio commands', () => {
  const { repo, claudeDir } = fixture();
  write(path.join(claudeDir, 'commands', '2aio-old.md'), 'retired');
  write(path.join(claudeDir, 'commands', 'user-note.md'), 'preserve');
  const result = spawnSync('bash', ['install.sh'], { cwd: repo, encoding: 'utf8', env: { ...process.env, CLAUDE_DIR: claudeDir } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(claudeDir, 'commands', '2aio-old.md')), false);
  assert.equal(fs.readFileSync(path.join(claudeDir, 'commands', 'user-note.md'), 'utf8'), 'preserve');
  assert.equal(fs.readFileSync(path.join(claudeDir, 'commands', '2aio-create.md'), 'utf8'), 'create');
  assert.equal(fs.readFileSync(path.join(claudeDir, 'commands', '2aio-check.md'), 'utf8'), 'check');
  assert.equal(fs.readFileSync(path.join(claudeDir, '2aio', 'lanes', '2aio-build.md'), 'utf8'), 'build lane');
  assert.match(result.stdout, /removed retired command: 2aio-old\.md/);
});
