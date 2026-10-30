// Every locale says the same thing, in its own language.
//
// The 1.20.x releases added strings in three languages at once, and two of the
// three were wrong in ways a key-parity test cannot see: `/help tasks` answered
// with literal double quotes around the sentence (the string was written as a
// JS literal that already contained quotes), and the Russian plugin list said
// "(disabled)" in English. Both shipped because nothing looked at the *shape*
// of a translated string, only at whether the key existed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, keysOf, t } from '../core/i18n.mjs';

/** Every key, in every language, as the bridge would render it. */
function allStrings() {
  const rows = [];
  for (const lang of LANGS) {
    for (const key of keysOf(lang)) rows.push({ lang, key, value: String(t(lang, key)) });
  }
  return rows;
}

test('no string is wrapped in ASCII quotes', () => {
  const wrapped = allStrings().filter(({ value }) => {
    const trimmed = value.trim();
    return /^["'`]/.test(trimmed) || /["'`]$/.test(trimmed);
  });
  assert.deepEqual(
    wrapped.map(({ lang, key }) => `${lang} ${key}`),
    [],
    'a translated sentence never carries the quotes of the JS literal it was written in',
  );
});

test('every string is non-empty and has no stray template hole', () => {
  for (const { lang, key, value } of allStrings()) {
    assert.ok(value.trim().length > 0, `${lang} ${key} is empty`);
    assert.doesNotMatch(value, /\$\{|\bundefined\b|\bNaN\b/, `${lang} ${key} leaks a value`);
  }
});

test('a Russian or Chinese string is not the English one', () => {
  const english = new Map(keysOf('en').map((key) => [key, String(t('en', key))]));
  // A format with no words is the same in every language, and that is correct:
  // `{n}. {when} ({left}) — {text}` is punctuation and placeholders, not prose.
  // The test therefore looks for Latin *words* left after the holes are removed.
  // Three strings are genuinely shared: a product name, the word a person types
  // to mean "decide for me", and a model id that the desktop app chose.
  const shared = new Set(['ctrl.doctor.telegram', 'ctrl.lang.auto', 'ctrl.model.withDesktop']);
  const prose = (value) => value.replace(/\{[a-z0-9_]+\}/gi, ' ').replace(/[^\p{L}]+/gu, ' ').trim();
  const wordy = (value) => /\b[A-Za-z]{4,}\b/.test(prose(value));
  for (const lang of ['ru', 'zh']) {
    const same = keysOf(lang).filter((key) => {
      if (shared.has(key)) return false;
      const value = String(t(lang, key));
      return value === english.get(key) && wordy(value);
    });
    assert.deepEqual(same, [], `${lang} still answers in English for these keys`);
  }
});
