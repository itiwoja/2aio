import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';
import { extractServedScript } from './helpers/served-script.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));

test('dashboard が配信するクライアント script は構文的に正しい', () => {
  const script = extractServedScript(path.join(here, '..', 'dashboard.mjs'));
  assert.doesNotThrow(() => new vm.Script(script), '配信クライアント JS に構文エラー');
});
