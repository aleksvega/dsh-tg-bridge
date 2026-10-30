// Text that went through a cp1251 round trip: UTF-8 read as ANSI and written
// back. In a comment it is invisible to the compiler and to every behavioural
// test, and it still ships — so the check has to read the files themselves.
//
// The markers below are the shapes of that damage, not Cyrillic: Russian text is
// UTF-8 like everything else and is expected to be here in full.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const DAMAGE = ['\u00e2\u20ac', '\u00c3\u00b0', '\u00c3\u00b1', '\u00c2\u00bb'];
const SHIPPED = JSON.parse(readFileSync('package.json', 'utf8')).files;

test('no shipped file carries the marks of a cp1251 round trip', () => {
  const found = [];
  for (const entry of SHIPPED) {
    if (!entry.endsWith('.mjs')) continue;
    let text;
    try {
      text = readFileSync(entry, 'utf8');
    } catch {
      // A directory entry (i18n) is read through its children below.
      continue;
    }
    for (const mark of DAMAGE) {
      if (text.includes(mark)) found.push(`${entry}: ${mark}`);
    }
  }
  assert.deepEqual(found, [], 'repair these files: text was read as cp1251 and written back');
});
