/**
 * Guard: the settings card and the translation table agree.
 *
 * The card is a view: every row it draws has a label and a hint, and every
 * button maps back to a command a person could have typed. Both are easy to
 * break silently — a missing key renders its own name, and a wrong command runs
 * the wrong thing — so both are checked here rather than by eye.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LANGS, t } from '../i18n.mjs';
import { SETTINGS_PAGES, commandFor, renderSettingsCard, settingsButtons, settingsCurrent } from '../settings-card.mjs';

const card = readFileSync(new URL('../settings-card.mjs', import.meta.url), 'utf8');
const ids = [...new Set([...card.matchAll(/id: '([a-z0-9-]+)'/g)].map((m) => m[1]))];
const inEachLanguage = (key) => LANGS.every((lang) => typeof t(lang, key) === 'string' && t(lang, key) !== key);

test('every row has a label and a hint in all three languages', () => {
  const missing = [];
  for (const id of ids) {
    for (const kind of ['label', 'hint']) {
      if (!inEachLanguage(`settings.${id}.${kind}`)) missing.push(`settings.${id}.${kind}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every page has a title and a tab word in all three languages', () => {
  for (const page of SETTINGS_PAGES) {
    assert.equal(inEachLanguage(`settings.${page}.title`), true, `title ${page}`);
    assert.equal(inEachLanguage(`settings.tab.${page}`), true, `tab ${page}`);
  }
  for (const key of ['settings.row.toggle', 'settings.row.action', 'settings.notSet', 'settings.state.on', 'settings.state.off', 'settings.state.auto', 'settings.card.foot']) {
    assert.equal(inEachLanguage(key), true, key);
  }
});

test('a rendered card names no untranslated key and every payload fits Telegram', () => {
  const current = settingsCurrent({ config: {}, state: {}, key: '1:2' });
  for (const lang of LANGS) {
    for (const page of SETTINGS_PAGES) {
      const view = renderSettingsCard({ page, t: (k, vars) => t(lang, k, vars), current, updateMode: 'check' });
      assert.doesNotMatch(view.text, /settings\.[a-z]/, `${lang}/${page} leaked a key`);
      assert.ok(view.text.length > 0);
      for (const row of view.keyboard) {
        for (const button of row) assert.ok(Buffer.byteLength(button.data) <= 64, button.data);
      }
    }
  }
});

test('every switch points at the command that owns it', () => {
  const current = settingsCurrent({ config: {}, state: {}, key: '1' });
  const tt = (k, vars) => t('en', k, vars);
  const expected = {
    'm:reasoning:on': '/reasoning on',
    'm:reasoning:off': '/reasoning off',
    'm:lang:en': '/lang en',
    'm:lang:ru': '/lang ru',
    'm:lang:zh': '/lang zh',
    'm:u-late:on': '/update on',
    'm:u-late:off': '/update off',
    'm:u-auto:auto': '/update auto',
    'm:thoughts': '/thoughts',
    'm:model': '/model',
    'm:u-install': '/update confirm',
  };
  for (const [data, command] of Object.entries(expected)) {
    assert.equal(commandFor({ t: tt, current }, data)?.command, command, data);
  }
  assert.deepEqual(commandFor({ t: tt, current }, 'm:agent'), { page: 'agent' });
  // A button from an older card changes nothing.
  assert.equal(commandFor({ t: tt, current }, 'm:gone:on'), null);
  assert.equal(commandFor({ t: tt, current }, 'm:reasoning:sideways'), null);
});

test('the current value decides which button is marked', () => {
  const tt = (k, vars) => t('en', k, vars);
  const on = settingsButtons({ t: tt, current: { reasoning: true, lang: 'ru' }, updateMode: 'off' });
  const marked = (id) => on.filter((b) => b.id === id && b.active).map((b) => b.value);
  assert.deepEqual(marked('reasoning'), ['on']);
  assert.deepEqual(marked('lang'), ['ru']);
  // off means "no notices", so the off button is the one in force.
  assert.deepEqual(marked('u-late'), ['off']);
  assert.deepEqual(marked('u-auto'), []);
});