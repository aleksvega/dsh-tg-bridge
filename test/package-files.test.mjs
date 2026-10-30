// A published package must be able to start. The 1.13.0 tarball shipped
// `bridge.mjs` without `format.mjs`, so every global install failed on the
// first import and no test noticed — the tests run from the checkout, where the
// file exists. These two tests run against `package.json`, the only list npm
// obeys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const files = pkg.files || [];

// Docs are part of the product, not decoration: the chat answers "see
// docs/VOICE.md" and the README links them. A page that exists in the checkout
// but not in the tarball leaves that pointer dead for every npm user, and
// nothing else in the suite reads `docs/`.
test('every page under docs/ ships', () => {
  const covered = (name) => files.includes(name) || files.includes('docs/');
  const missing = readdirSync(join(root, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`)
    .filter((name) => !covered(name));
  assert.deepEqual(missing, [], 'add these to package.json files[]');
});

/** `files[]` entries that name one module (a directory entry covers its tree). */
function shippedModules() {
  const named = new Set(files.filter((entry) => entry.endsWith('.mjs')).map((entry) => entry.replace(/^\.\//, '')));
  for (const entry of files.filter((e) => e.endsWith('/'))) {
    for (const name of readdirSync(join(root, entry), { withFileTypes: true })) {
      if (name.isFile() && name.name.endsWith('.mjs')) named.add(`${entry}${name.name}`);
    }
  }
  return named;
}

test('every module in the repo is published, or is not code', () => {
  const named = shippedModules();
  const missing = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
    .map((entry) => entry.name)
    .filter((name) => !named.has(name));
  assert.deepEqual(missing, [], 'add these to package.json files[]');
});

test('every relative import of a shipped module resolves to a shipped file', () => {
  const named = shippedModules();
  const broken = [];
  for (const module of named) {
    const path = join(root, module);
    if (!existsSync(path)) {
      broken.push(`${module}: listed in files[] but missing on disk`);
      continue;
    }
    const text = readFileSync(path, 'utf8');
    for (const match of text.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)) {
      const target = join(dirname(module), match[1]);
      const normal = relative(root, target).replace(/\\/g, '/');
      if (!named.has(normal)) broken.push(`${module} imports ${normal}, which is not published`);
    }
  }
  assert.deepEqual(broken, []);
});

test('the entry points named in package.json are published', () => {
  const named = shippedModules();
  for (const entry of [pkg.main, pkg.bin?.['dsh-tg']].filter(Boolean)) {
    assert.ok(named.has(entry.replace(/^\.\//, '')), `${entry} is not in files[]`);
  }
});