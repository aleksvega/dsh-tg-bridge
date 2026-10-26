// A refusal is only useful if it is said in the reader's language: a key name
// in the chat is a bug the person cannot report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REFUSAL_REASONS } from '../rewind.mjs';
import { t } from '../i18n.mjs';

// Chinese says the same thing in fewer characters, so the length that makes an
// English sentence here would reject a perfectly good Chinese one.
const SHORTEST = { en: 20, ru: 20, zh: 10 };

test('every refusal the planner can return has words in every language', () => {
  assert.ok(REFUSAL_REASONS.length >= 6, 'the list itself must be empty');
  for (const [lang, shortest] of Object.entries(SHORTEST)) {
    for (const reason of REFUSAL_REASONS) {
      const said = t(lang, `ctrl.rewind.refused.${reason}`, { total: 3, dropped: 1 });
      assert.ok(!said.startsWith('ctrl.'), `${lang} has no text for refusal "${reason}"`);
      assert.ok(said.length >= shortest, `${lang} refusal "${reason}" is not a sentence: ${said}`);
      assert.ok(!said.includes('undefined'), `${lang} refusal "${reason}" has an unfilled placeholder`);
    }
  }
});

test('the planner only ever returns reasons from that list', () => {
  // Every `reason: 'x'` in the module must be a known refusal, so a new one
  // cannot be added without words.
  const source = readFileSync(new URL('../rewind.mjs', import.meta.url), 'utf8');
  const found = new Set([...source.matchAll(/reason: '([a-z-]+)'/g)].map((match) => match[1]));
  assert.ok(found.size >= 6, 'the scan found nothing, which means it is broken');
  for (const reason of found) assert.ok(REFUSAL_REASONS.includes(reason), `"${reason}" has no words`);
});