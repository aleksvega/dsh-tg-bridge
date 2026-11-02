// A removed control must not leave its words behind. When `/model` lost its
// grouping step, `ctrl.model.pickGroup` stayed in three locale tables: the parity
// test only asks that every language has the same keys, and the existence test
// only asks that every used key exists — nothing asked the reverse, so text for a
// screen nobody can reach sat in the bot's vocabulary and looked maintained.
//
// The rule needs no hand list. A key is a consumer if the shipped code mentions it
// literally, or builds it from a prefix the code spells out: `settings.${row}.label`
// consumes every `settings.*` key, and so does `'ctrl.cmd.' + name`. Everything else
// is dead unless someone writes it down here with a reason — which is the point:
// adding a dead string now costs an argument.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import en from '../i18n/en.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Keys nothing in the code can reach: no literal, no composed prefix. */
export function unreachableKeys(keys, corpus) {
  const prefixes = new Set();
  // `settings.${row}.label` — the literal part is a prefix of the final key.
  for (const m of corpus.matchAll(/`([A-Za-z0-9_.-]+)\$\{/g)) prefixes.add(m[1]);
  // 'ctrl.cmd.' + name
  for (const m of corpus.matchAll(/'([A-Za-z0-9_.-]+\.)'\s*\+/g)) prefixes.add(m[1]);
  return keys.filter((key) => !corpus.includes(key) && ![...prefixes].some((prefix) => key.startsWith(prefix)));
}

/** Every shipped module, with locale tables left out: they define, not consume. */
function shippedSource(dir = ROOT, out = '') {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'test', 'openspec', 'docs', 'i18n'].includes(name)) continue;
    if (name.startsWith('update-backup')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out = shippedSource(path, out);
    else if (name.endsWith('.mjs')) out += readFileSync(path, 'utf8');
  }
  return out;
}

test('a composed prefix is enough, a literal is enough, a stray word is not', () => {
  const corpus = "t(`settings.${row}.label`) + 'ctrl.cmd.' + name + t(lang, 'btn.close')";
  const keys = ['settings.lang.label', 'ctrl.cmd.update', 'btn.close', 'ctrl.model.gone'];
  assert.deepEqual(unreachableKeys(keys, corpus), ['ctrl.model.gone']);
});

test('every locale key has a consumer in the shipped code', () => {
  const keys = Object.keys(en);
  const dead = unreachableKeys(keys, shippedSource());
  assert.deepEqual(dead, [], `keys no screen can reach:\n${dead.join('\n')}`);
});