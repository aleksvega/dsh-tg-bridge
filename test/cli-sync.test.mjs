// A new install copies the bridge into ~/.dsh/tg-bridge, because every helper
// looks for it there. That list was kept by hand and fell behind the code: a
// module it did not name stayed behind, and the bridge started from a directory
// that could not import what it needed. `package.json` files[] is the list npm
// already keeps honest, so this test requires the copy to read it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const dir = new URL('../', import.meta.url);
const cli = readFileSync(new URL('cli.mjs', dir), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('package.json', dir), 'utf8'));

/** The value assigned to `name`, up to the semicolon that ends the statement. */
const assignment = (name) => cli.match(new RegExp(`const ${name} = (.*?);\\n`))?.[1] ?? '';

test('the runtime copy list comes from package.json, not from a hand-kept array', () => {
  const value = assignment('RUNTIME_FILES');
  assert.notEqual(value, '', 'RUNTIME_FILES is missing');
  assert.match(value, /pkg\.files/, 'RUNTIME_FILES must be derived from pkg.files');
});

test('every file the bridge imports is published', () => {
  const missing = ['format.mjs', 'goals.mjs', 'goal.mjs', 'aset-schema.mjs'].filter((name) => !pkg.files.includes(name));
  assert.deepEqual(missing, []);
  for (const name of pkg.files.filter((entry) => entry.endsWith('.mjs'))) {
    assert.ok(existsSync(new URL(name, dir)), `${name} is listed but not shipped`);
  }
});