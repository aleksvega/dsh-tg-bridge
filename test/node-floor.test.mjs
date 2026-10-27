// The Node floor used to be declared four different ways: engines said 24,
// install.sh and install.ps1 said 20, QUICKSTART said 20, and setup's sanity
// check said 18. A person on Node 22 passed every check and then died at the
// first zstd import. This test reads the files a user actually meets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(join(here, name), 'utf8').replace(/\r\n/g, '\n');

const floor = () => Number(JSON.parse(read('package.json')).engines.node.replace(/[^\d]/g, ''));

test('the installers and the docs state the same floor as engines', () => {
  const want = floor();
  assert.ok(want >= 24, `engines says ${want}`);

  const sh = read('install.sh');
  const ps = read('install.ps1');
  const quick = read('QUICKSTART.md');

  for (const [name, text] of [['install.sh', sh], ['install.ps1', ps], ['QUICKSTART.md', quick]]) {
    const claimed = [...text.matchAll(/(?:node\s*>=\s*|Node\.js\s*)(\d{2})/gi)].map((m) => Number(m[1]));
    for (const n of claimed) {
      assert.equal(n, want, `${name} promises Node ${n} while engines requires ${want}`);
    }
    assert.ok(claimed.length > 0, `${name} no longer states a Node version`);
  }
});

test("setup's own sanity check refuses an old Node", () => {
  const setup = read('setup.mjs');
  const check = setup.slice(setup.indexOf('const major = Number'), setup.indexOf('const major = Number') + 400);
  assert.match(check, new RegExp(`major >= ${floor()}`), 'setup must accept exactly the declared floor');
});
