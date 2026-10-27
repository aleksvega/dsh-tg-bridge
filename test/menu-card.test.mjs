// The panel: every button must be a command that exists, a press must never be
// able to start an AI turn, and moving between pages must edit one message
// instead of sending more. The panel is also the only place where a person can
// find the whole bot without reading /help, so nothing documented may be missing
// from it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROL_COMMANDS, DOCUMENTED_COMMANDS } from '../control.mjs';
import {
  MENU_GROUPS, MENU_PREFIX, commandForName, isMenuPress, keyboardCommand, menuCommands,
  menuTarget, renderPanel, replyKeyboard, unlistedCommands,
} from '../menu-card.mjs';
import { t } from '../i18n.mjs';

const tr = (lang) => (key, vars) => t(lang, key, vars);
const allButtons = (card) => card.keyboard.flat();

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

test('callback data fits Telegram, for every button of every page', () => {
  const cards = [renderPanel({ t: tr('en') }), ...MENU_GROUPS.map((page) => renderPanel({ t: tr('en'), page }))];
  for (const card of cards) {
    for (const button of allButtons(card)) {
      assert.ok(button.data.length <= 64, `${button.data} is too long for a callback`);
      assert.equal(isMenuPress(button.data), true, `${button.data} is not a menu press`);
    }
  }
  assert.equal(isMenuPress('m:reply'), false);
});

test('the hub offers one button per section and a way out', () => {
  const hub = renderPanel({ t: tr('ru') });
  const targets = allButtons(hub).map((button) => menuTarget(button.data));
  assert.deepEqual(targets.filter((target) => target.kind === 'section').map((target) => target.page), MENU_GROUPS);
  assert.deepEqual(targets.filter((target) => target.kind === 'close'), [{ kind: 'close' }]);
  assert.ok(hub.text.length > 40 && hub.text.length < 400, 'the panel is a shortcut, not the help text');
});

test('a section page holds its commands, then back, then onward and close', () => {
  for (const page of MENU_GROUPS) {
    const card = renderPanel({ t: tr('ru'), page });
    assert.ok(card, `${page} has no page`);
    assert.ok(card.text.length > 20 && card.text.length < 400, `${page} text is not a card`);
    for (const row of card.keyboard) assert.ok(row.length <= 2, `${page} has a row of ${row.length}`);
    const commands = allButtons(card).filter((button) => menuTarget(button.data).kind === 'command');
    assert.ok(commands.length >= 3, `${page} offers only ${commands.length} command(s)`);
    const tail = allButtons(card).slice(-3).map((button) => menuTarget(button.data).kind);
    assert.deepEqual(tail, ['hub', 'section', 'close'], `${page} cannot be left`);
  }
});

test('an unknown page falls back to the hub instead of drawing nothing', () => {
  const fallback = renderPanel({ t: tr('en'), page: 'nope' });
  assert.deepEqual(fallback, renderPanel({ t: tr('en') }));
});

test('the panel is written in the language asked for', () => {
  assert.match(renderPanel({ t: tr('zh') }).text, /机器人/);
  assert.match(renderPanel({ t: tr('ru') }).text, /Выбери раздел/);
  assert.match(renderPanel({ t: tr('en') }).text, /Pick a section/);
  for (const page of MENU_GROUPS) assert.ok(renderPanel({ t: tr('ru'), page }).text.length > 10, page);
});

test('every section has a name and a sentence, in every language', () => {
  for (const lang of ['en', 'ru', 'zh']) {
    for (const page of MENU_GROUPS) {
      for (const key of [`ctrl.menu.group.${page}`, `ctrl.menu.hint.${page}`]) {
        const said = t(lang, key);
        assert.ok(!said.startsWith('ctrl.menu'), `${lang} lacks ${key}`);
        assert.ok(said.length >= 2, `${lang}/${key} is empty`);
      }
    }
    assert.ok(t(lang, 'ctrl.menu.close').length > 2, `${lang} has no close label`);
    assert.ok(t(lang, 'ctrl.menu.back').length > 2, `${lang} has no back label`);
  }
});

test('a button carries the command it runs, so the panel teaches the names', () => {
  for (const page of MENU_GROUPS) {
    const card = renderPanel({ t: tr('en'), page });
    for (const button of allButtons(card)) {
      const target = menuTarget(button.data);
      if (target.kind !== 'command') continue;
      assert.ok(button.text.startsWith('/'), `${target.name} has a label that hides its command`);
      assert.ok(button.text.includes(target.name), `${button.text} does not name /${target.name}`);
    }
  }
});

test('the panel reaches every documented command', () => {
  assert.deepEqual(unlistedCommands(), [], `the panel hides: ${unlistedCommands().join(', ')}`);
  const shown = new Set(menuCommands());
  assert.ok(DOCUMENTED_COMMANDS.length >= 36, 'some commands went missing from the documented list');
  assert.equal(shown.has('menu'), false, 'the panel is where the panel already is');
});

test('the panel never offers an old spelling of a command', () => {
  for (const name of menuCommands()) {
    assert.notEqual(commandForName(name, { t: tr('en') }), `/${name}s`, `${name} would run a stale name`);
  }
  for (const page of MENU_GROUPS) {
    for (const button of allButtons(renderPanel({ t: tr('en'), page }))) {
      // `/tasks` is no longer an alias: it is the tap card, and the only way to
      // tick a task without typing.
      assert.ok(!/\/models|\/agentset|\/plugin\b/.test(button.text), `${button.text} advertises an alias`);
    }
  }
});

test('the reply keyboard offers four keys that all map to a command', () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const rows = replyKeyboard({ t: tr(lang) });
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.length, 2);
      for (const key of row) {
        const typed = keyboardCommand(key.text, { t: tr(lang) });
        assert.match(typed, /^\/(status|menu|stop|new)$/, `${lang} key "${key.text}" maps to "${typed}"`);
      }
    }
  }
  // A word that is not a key stays a prompt, which is what typing it means.
  assert.equal(keyboardCommand('привет', { t: tr('ru') }), '');
});

test('the panel runs the command, not a copy of it', () => {
  // A press does what typing the command does, argument or not: the bare form
  // answers with its own usage line or its own card. Only the two that change
  // something when typed alone open their explanation instead.
  assert.equal(commandForName('status', { t: tr('en') }), '/status');
  assert.equal(commandForName('rewind', { t: tr('en') }), '/rewind');
  assert.equal(commandForName('cd', { t: tr('en') }), '/cd');
  assert.equal(commandForName('model', { t: tr('en') }), '/model');
  assert.equal(commandForName('new', { t: tr('en') }), '/help new');
  assert.equal(commandForName('stop', { t: tr('en') }), '/help stop');
});

test('every press is a command, never a sentence', () => {
  // The failure this guards against: most of the panel answering with a help
  // paragraph, so the buttons looked like text and not like commands.
  for (const name of menuCommands()) {
    const typed = commandForName(name, { t: tr('ru') });
    const [head, arg] = typed.split(' ');
    assert.ok(CONTROL_COMMANDS.includes(head.slice(1)), `${typed} is not a command`);
    if (arg) assert.match(head, /^\/help$/, `${name} sends "${typed}" instead of running`);
  }
});
