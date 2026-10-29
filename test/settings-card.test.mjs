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
    'm:reasoning:card': '/reasoning card',
    'm:reasoning:chat': '/reasoning chat',
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
  assert.deepEqual(commandFor({ t: tt, current }, 'm:agent'), { tab: 'agent' });
  // A button from an older card changes nothing.
  assert.equal(commandFor({ t: tt, current }, 'm:gone:on'), null);
  assert.equal(commandFor({ t: tt, current }, 'm:reasoning:sideways'), null);
});

test('the card stays: every page carries its own way out', () => {
  // A press edits the card instead of replacing it, so the card has to be able
  // to close itself: leaving was the one thing the buttons could not do, and the
  // old answer was "delete the message by hand".
  const current = settingsCurrent({ config: {}, state: {}, key: '1' });
  const tt = (k, vars) => t('en', k, vars);
  for (const page of SETTINGS_PAGES) {
    const view = renderSettingsCard({ page, t: tt, current, updateMode: 'off' });
    const done = view.keyboard.flat().filter((b) => b.data === 'm:done');
    assert.equal(done.length, 1, `${page} has no way out`);
    assert.equal(done[0].text, t('en', 'settings.done'));
    assert.deepEqual(commandFor({ t: tt, current }, 'm:done'), { done: true });
  }
});

test('a press knows which page to redraw', () => {
  // The payload names the row, not the page. Without the page the caller cannot
  // re-render the card it just changed, and the old code settled for one line.
  const current = settingsCurrent({ config: {}, state: {}, key: '1' });
  const tt = (k, vars) => t('en', k, vars);
  assert.equal(commandFor({ t: tt, current }, 'm:reasoning:chat')?.page, 'reply');
  assert.equal(commandFor({ t: tt, current }, 'm:pin:on')?.page, 'reply');
  assert.equal(commandFor({ t: tt, current }, 'm:u-late:on')?.page, 'updates');
  assert.equal(commandFor({ t: tt, current }, 'm:model')?.page, 'agent');
});

test('a switch is not a tab, and a tab is not a switch', () => {
  // 1.26.0 shipped a dead card because of exactly this: a switch carried `page`,
  // the caller read "has a page" as "show me that page", and every tap redrew an
  // identical card and ran nothing. No error, no reply, no change — the worst
  // kind of bug, because it looks like the button is broken rather than the code.
  const current = settingsCurrent({ config: {}, state: {}, key: '1' });
  const tt = (k, vars) => t('en', k, vars);
  const switchPress = commandFor({ t: tt, current }, 'm:reasoning:chat');
  assert.equal(switchPress.tab, undefined, 'a switch must not look like a tab');
  assert.equal(switchPress.command, '/reasoning chat');
  const tabPress = commandFor({ t: tt, current }, 'm:agent');
  assert.deepEqual(tabPress, { tab: 'agent' });
  assert.equal(tabPress.command, undefined, 'a tab must not look like a command');
});

test('only the value in force is marked, in the text and on the button', () => {
  const current = settingsCurrent({ config: {}, state: {}, key: '1' });
  const tt = (k, vars) => t('en', k, vars);
  const view = renderSettingsCard({ page: 'reply', t: tt, current, updateMode: 'off' });
  // Two ends, one dot per switch: a card where every option is marked says
  // nothing, and a card that marks the wrong end says worse.
  const dots = view.text.match(/●/g) || [];
  const marked = view.keyboard.flat().filter((b) => b.text.startsWith('●'));
  assert.deepEqual(marked.map((b) => b.data), ['m:reasoning:card', 'm:pin:off']);
  assert.equal(dots.length, marked.length, 'the text and the buttons disagree about what is on');
  assert.equal(view.text.includes('○'), false);
});

test('the pin switch reads the same place /pin writes', () => {
  assert.equal(settingsCurrent({ config: {}, state: {}, key: '1' }).pin, 'off');
  assert.equal(settingsCurrent({ config: {}, state: { pin: { '1': 'on' } }, key: '1' }).pin, 'on');
  // A value written for another topic is not this topic's.
  assert.equal(settingsCurrent({ config: {}, state: { pin: { '2': 'on' } }, key: '1' }).pin, 'off');
  // The install default only applies where the topic has said nothing.
  assert.equal(settingsCurrent({ config: { pin: 'on' }, state: {}, key: '1' }).pin, 'on');
  assert.equal(settingsCurrent({ config: { pin: 'on' }, state: { pin: { '1': 'off' } }, key: '1' }).pin, 'off');
  // The shapes the older switches migrated through.
  assert.equal(settingsCurrent({ config: {}, state: { pin: { '1': true } }, key: '1' }).pin, 'on');
  assert.equal(settingsCurrent({ config: {}, state: { pin: { '1': false } }, key: '1' }).pin, 'off');
});

test('the current value decides which button is marked', () => {
  const tt = (k, vars) => t('en', k, vars);
  const on = settingsButtons({ t: tt, current: { reasoning: 'card', lang: 'ru' }, updateMode: 'off' });
  const marked = (id) => on.filter((b) => b.id === id && b.active).map((b) => b.value);
  assert.deepEqual(marked('reasoning'), ['card']);
  assert.deepEqual(marked('lang'), ['ru']);
  // off means "no notices", so the off button is the one in force.
  assert.deepEqual(marked('u-late'), ['off']);
  assert.deepEqual(marked('u-auto'), []);
  // The third end of the same switch: the chat, not a second command.
  const chat = settingsButtons({ t: tt, current: { reasoning: 'chat', lang: 'auto' }, updateMode: 'off' });
  assert.deepEqual(chat.filter((b) => b.id === 'reasoning' && b.active).map((b) => b.value), ['chat']);
});