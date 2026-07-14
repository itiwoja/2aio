#!/usr/bin/env node
// #67: pre-publish check — the distributed repo must not leak a maintainer's local
// absolute paths (macOS /Users/<name>, Linux /home/<name>) or personal usernames.
// Deliberately kept at repo root (not scripts/) — the installer copies scripts/*.mjs
// into every user's ~/.claude/2aio/scripts/, and this check is repo-maintenance-only.
// Run: node check-portable-paths.mjs   (exits non-zero if anything is found)
import { spawnSync } from 'node:child_process';

// Generic placeholder segments (test fixtures, illustrative examples) are allowed.
const ALLOWED_SEGMENTS = ['user', 'username', 'you', 'yourname', 'name', 'x', 'y', 'z', 'test', 'foo', 'bar', 'demo', 'example'];
const PATTERN = String.raw`/Users/[A-Za-z0-9_-]+|/home/[A-Za-z0-9_-]+|1kkim`;

const result = spawnSync('git', ['grep', '-nEI', PATTERN, '--', '.', ':!*.lock', ':!check-portable-paths.mjs'], { encoding: 'utf8' });
// git grep exit codes: 0 = matches found, 1 = no matches, >1 = error
if (result.status !== null && result.status > 1) {
  console.error(result.stderr || 'git grep failed');
  process.exit(result.status);
}

const lines = (result.stdout || '').split('\n').filter(Boolean);
const segmentRe = new RegExp(`/(?:Users|home)/([A-Za-z0-9_-]+)`, 'g');
const leaks = lines.filter((line) => {
  if (line.includes('1kkim')) return true;
  let m;
  segmentRe.lastIndex = 0;
  while ((m = segmentRe.exec(line))) {
    if (!ALLOWED_SEGMENTS.includes(m[1].toLowerCase())) return true;
  }
  return false;
});

if (leaks.length) {
  console.error('Portable-paths check FAILED — private absolute paths / usernames found:\n');
  leaks.forEach((l) => console.error('  ' + l));
  process.exit(1);
}
console.log('Portable-paths check passed — no private absolute paths / usernames found.');
