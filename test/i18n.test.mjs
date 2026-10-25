// Every locale must describe the same surface: one missing key means a Russian
// sentence leaks into an English or Chinese chat, which is exactly the bug this
// file exists to catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LANGS, keysOf, t } from '../i18n.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('all locales define the same keys', () => {
  const base = keysOf('ru').sort();
  assert.ok(base.length > 20);
  for (const lang of LANGS) {
    assert.deepEqual(keysOf(lang).sort(), base, `locale ${lang} diverges from ru`);
  }
});

test('placeholders match across locales', () => {
  const vars = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const key of keysOf('ru')) {
    const expected = vars(t('ru', key));
    for (const lang of LANGS) {
      assert.deepEqual(vars(t(lang, key)), expected, `${key} in ${lang}`);
    }
  }
});

test('every t() key used by the bridge exists', () => {
  const source = readFileSync(join(ROOT, 'bridge.mjs'), 'utf8');
  const used = new Set([...source.matchAll(/\bt\([^,]+,\s*'([^']+)'/g)].map((m) => m[1]));
  const known = new Set(keysOf('ru'));
  const missing = [...used].filter((key) => !known.has(key));
  assert.deepEqual(missing, [], `unknown keys: ${missing.join(', ')}`);
});
