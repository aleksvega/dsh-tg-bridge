// `sync-runtime.mjs` copied only the root `.mjs` files, so the day the
// dictionary moved into `i18n/*.mjs` the runtime directory was left with an
// import that could not resolve — the bridge would have refused to start after
// the next `/restart confirm`. This test runs the real script into a temp
// directory and boots the result.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');

test('a synced runtime contains every module the package ships, and boots', () => {
  const target = mkdtempSync(join(tmpdir(), 'runtime-'));
  const run = spawnSync(process.execPath, [join(here, 'sync-runtime.mjs'), '--dir', target], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);

  const files = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).files || [];
  const missing = files.filter((entry) => !existsSync(join(target, entry.replace(/\/$/, ''))));
  assert.deepEqual(missing, [], 'every shipped entry must reach the runtime');
  assert.equal(existsSync(join(target, 'i18n', 'en.mjs')), true, 'a nested module is imported by path');
  assert.ok(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version, '/version reads this');

  return import(pathToFileURL(join(target, 'i18n.mjs')).href).then((m) => {
    assert.match(m.t('en', 'task.listTitle', { done: 1, total: 2 }), /1\/2/);
  });
});
