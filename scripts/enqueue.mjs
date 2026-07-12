#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enqueue } from '../lib/queue.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  console.error('usage: node scripts/enqueue.mjs --repo <id> [--kind <kind>] [--theme <s>] [--target <s>] [--prompt <s>] [--not-before <ISO>] [--port <n>]');
}

function invalid(message) {
  if (message) console.error(message);
  usage();
  process.exit(2);
}

const options = { kind: 'build', theme: '', target: '', prompt: '', notBefore: null };
const names = new Map([
  ['--repo', 'repo'],
  ['--kind', 'kind'],
  ['--theme', 'theme'],
  ['--target', 'target'],
  ['--prompt', 'prompt'],
  ['--not-before', 'notBefore'],
  ['--port', 'port'],
]);

for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i];
  const key = names.get(name);
  const value = process.argv[i + 1];
  if (!key || value === undefined || value.startsWith('--')) invalid();
  options[key] = value;
}

if (!options.repo) invalid();
if (options.notBefore && Number.isNaN(Date.parse(options.notBefore))) invalid('not-before must be a valid ISO date');

const port = options.port === undefined ? Number(process.env.AIO_CONTROL_PORT || 7900) : Number(options.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) invalid('port must be an integer from 1 to 65535');

const params = new URLSearchParams({
  repo: options.repo,
  kind: options.kind,
  theme: options.theme,
  target: options.target,
  prompt: options.prompt,
});
if (options.notBefore) params.set('notBefore', options.notBefore);

const url = `http://127.0.0.1:${port}/api/enqueue?${params}`;
let response;
try {
  response = await fetch(url, { method: 'POST' });
} catch {
  const job = enqueue(ROOT, {
    repo: options.repo,
    kind: options.kind,
    args: { theme: options.theme, target: options.target },
    prompt: options.prompt,
    notBefore: options.notBefore,
  });
  console.log(`enqueued directly (server down): ${job.id}`);
  process.exit(0);
}

let body;
try {
  body = await response.json();
} catch {
  console.error(`server returned HTTP ${response.status}`);
  process.exit(1);
}

if (response.status === 422) {
  console.error(body.err || 'request rejected by server');
  process.exit(1);
}
if (!response.ok || !body.ok || !body.job?.id) {
  console.error(body.err || `server returned HTTP ${response.status}`);
  process.exit(1);
}

console.log(`enqueued via server: ${body.job.id}`);
