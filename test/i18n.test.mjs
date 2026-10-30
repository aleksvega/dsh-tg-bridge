// Every locale must describe the same surface: one missing key means a Russian
// sentence leaks into an English or Chinese chat, which is exactly the bug this
// file exists to catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LANGS, detectLang, keysOf, t, resolveLang } from '../core/i18n.mjs';

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

test('a topic remembers the language of its first message', () => {
  const state = {};
  const msg = { from: { language_code: 'ru' } };
  assert.equal(resolveLang(state, '1:2', msg, {}), 'ru');
  // The button press that follows has no message: it must still answer in ru.
  assert.equal(resolveLang(state, '1:2', null, {}), 'ru');
  assert.equal(state.lang['1:2'], 'ru');
});

test('an explicit topic choice wins over the learned one', () => {
  const state = { lang: { '1:2': 'en' } };
  assert.equal(resolveLang(state, '1:2', { from: { language_code: 'ru' } }, {}), 'en');
  assert.equal(state.lang['1:2'], 'en');
});

test('an unknown or missing locale lands in English', () => {
  assert.equal(resolveLang({}, '1:2', { from: { language_code: 'de' } }, {}), 'en');
  assert.equal(resolveLang({}, '1:2', null, {}), 'en');
  // config.lang is a default, not a guess: it is used when the topic has none.
  assert.equal(resolveLang({}, '1:2', { from: { language_code: 'zh-hans' } }, { lang: 'ru' }), 'ru');
});

test('a Chinese message in an English-locale client is answered in Chinese', () => {
  // The case the docs promise and the code used to miss: the phone menu says
  // English, the person writes Chinese, and the reply must follow the words.
  const state = {};
  const msg = { text: '为什么机器人没有回复', from: { language_code: 'en' } };
  assert.equal(resolveLang(state, '1:2', msg, {}), 'zh');
  assert.equal(state.lang['1:2'], 'zh');
});

test('the language comes from the message, not from a code word inside it', () => {
  const zh = { text: '为什么 npm install 失败', from: { language_code: 'en' } };
  assert.equal(resolveLang({}, '1:2', zh, {}), 'zh');
  const ru = { text: 'смотри путь к логу в подключённой папке', from: { language_code: 'en' } };
  assert.equal(resolveLang({}, '1:2', ru, {}), 'ru');
  // A Latin message stays with the locale: English is not detectable by script,
  // and guessing from it would flip German and French speakers into English.
  assert.equal(detectLang('why is the bot silent'), '');
  assert.equal(detectLang('好的'), '', 'two characters are not enough to switch');
});
