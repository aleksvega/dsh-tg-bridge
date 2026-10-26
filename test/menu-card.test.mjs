// The panel: every button must be a command that exists, a press must never be
// able to start an AI turn, and the card must be small enough to read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_COMMANDS } from '../control.mjs';
import { MENU_GROUPS, MENU_PREFIX, commandForName, isMenuPress, menuCommands, renderPanel } from '../menu-card.mjs';
import { t } from '../i18n.mjs';

const tr = (lang) => (key, vars) => t(lang, key, vars);

test('every button of the panel is a real command', () => {
  const known = new Set(CONTROL_COMMANDS);
  for (const name of menuCommands()) assert.ok(known.has(name), `${name} is on the panel but is not a command`);
});

test('every button leads somewhere — a command or its own explanation', () => {
  for (const name of menuCommands()) {
    const typed = commandForName(name, { t: tr('en') });
    assert.match(typed, /^\/[a-z]+/, `${name} has no command`);
    const [head] = typed.split(' ');
    assert.ok(CONTROL_COMMANDS.includes(head.slice(1)), `${typed} is not a command`);
  }
});

test('no button can start an AI turn', () => {
  // A press runs a slash command. If a mapping ever returned plain text, the
  // bridge would treat it as a prompt — and charge for an answer nobody asked.
  for (const name of menuCommands()) {
    assert.match(commandForName(name, { t: tr('ru') }), /^\//, `${name} would be sent as text`);
  }
});

test('a press for an unknown name does nothing', () => {
  assert.equal(commandForName('nosuchcommand', { t: tr('en') }), '');
});

test('callback data fits Telegram and cannot collide with other cards', () => {
  for (const name of menuCommands()) {
    const data = `${MENU_PREFIX}${name}`;
    assert.ok(data.length <= 64, `${data} is too long for a callback`);
    assert.equal(isMenuPress(data), true);
    assert.equal(isMenuPress(`t:${data}`), false);
    assert.equal(isMenuPress('m:reply'), false);
  }
});

test('the panel has a page per group, each with text and buttons', () => {
  for (const group of MENU_GROUPS) {
    const card = renderPanel({ t: tr('ru'), page: group });
    assert.ok(card, `${group} has no page`);
    assert.equal(card.keyboard[0].length, 4, `${group} should offer one row of buttons`);
    assert.ok(card.text.length > 40);
    assert.ok(card.text.length < 400, 'the panel is a shortcut, not the help text');
    // The tabs lead back to every page, including this one.
    assert.deepEqual(card.keyboard[1].map((b) => b.data), MENU_GROUPS.map((g) => `mn:g:${g}`));
  }
});

test('an unknown page falls back instead of drawing nothing', () => {
  assert.equal(renderPanel({ t: tr('en'), page: 'nope' }), null);
});

test('the panel is written in the language asked for', () => {
  assert.match(renderPanel({ t: tr('zh'), page: 'work' }).text, /机器人/);
  assert.match(renderPanel({ t: tr('ru'), page: 'work' }).text, /Нажми/);
  assert.match(renderPanel({ t: tr('en'), page: 'work' }).text, /Press a button/);
});

test('every button has its own name in every language', () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const labels = menuCommands().map((name) => t(lang, `ctrl.menu.item.${name}`));
    for (const label of labels) assert.ok(!label.startsWith('ctrl.menu'), `${lang} lacks a label for ${label}`);
    assert.equal(new Set(labels).size, labels.length, `${lang} repeats a button label`);
    for (const group of MENU_GROUPS) assert.ok(t(lang, `ctrl.menu.group.${group}`).startsWith('ctrl.menu') === false);
  }
});

test('the panel runs the command, not a copy of it', () => {
  // Commands that need an argument open their own explanation; the rest run
  // bare and answer with their own usage line when they need more.
  assert.equal(commandForName('status', { t: tr('en') }), '/status');
  assert.equal(commandForName('rewind', { t: tr('en') }), '/help rewind');
  assert.equal(commandForName('cd', { t: tr('en') }), '/help cd');
});