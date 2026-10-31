// A command exists in three places — the dispatcher's list, the help text, and
// the Telegram menu — and nothing used to compare them. `/settings` shipped into
// help and the menu while the dispatcher never learned it, so the bot answered
// "Неизвестная команда" for a command it had just recommended. This file makes
// the three lists one decision: any of them advertising a command the others do
// not know is a test failure, before a person finds it in the chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COMMAND_ALIASES, CONTROL_COMMANDS, DOCUMENTED_COMMANDS, MENU_COMMANDS } from '../chat/control.mjs';
import { LANGS, t } from '../core/i18n.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const known = new Set(CONTROL_COMMANDS);

/** `/model` → `model`; the trailing text of `/logs errors` is not a command. */
const names = (text) => [...new Set([...text.matchAll(/\/([a-z][a-z-]{1,20})\b/g)].map((m) => m[1]))];

test('every command /help advertises is a command the dispatcher knows', () => {
  for (const lang of LANGS) {
    const missing = names(t(lang, 'help.body')).filter((name) => !known.has(name));
    assert.deepEqual(missing, [], `${lang}/help mentions commands the bot would reject: ${missing.join(', ')}`);
  }
});

test('every command in the menu is a command the dispatcher knows', () => {
  // The menu rows live in the registry now, so this reads the same list the bot
  // publishes instead of parsing a second one out of bot-menu.mjs.
  const missing = MENU_COMMANDS.filter((name) => !known.has(name));
  assert.deepEqual(missing, [], `the menu offers commands the bot would reject: ${missing.join(', ')}`);
});

test('every documented command is listed in /help', () => {
  // Old spellings (`/tasks`, `/models`, `/plugin`, `/agentset`) are accepted and
  // deliberately undocumented: a name in the help text is a name to mistype.
  const documented = new Set(LANGS.flatMap((lang) => names(t(lang, 'help.body'))));
  const silent = DOCUMENTED_COMMANDS.filter((name) => !documented.has(name));
  assert.deepEqual(silent, [], `commands a person cannot discover: ${silent.join(', ')}`);
  assert.ok(CONTROL_COMMANDS.length >= DOCUMENTED_COMMANDS.length);
  // `/tasks` used to be listed here: it is a command of its own now, because the
  // tappable checklist the README advertises lived in a case the alias made
  // unreachable, and `/tasks 1` added a task called "1".
  assert.ok(Object.keys(COMMAND_ALIASES).length >= 3, 'the alias table went missing');
});

test('/settings is reachable, in all three languages', () => {
  assert.ok(known.has('settings'));
  for (const lang of LANGS) assert.ok(names(t(lang, 'help.body')).includes('settings'), lang);
});

test('every documented command explains itself when asked', () => {
  // `/help <command>` answers with `ctrl.help.about.<name>`. When that key is
  // missing the reader gets the group line instead — a command that shows up in
  // the list and then cannot say what it does. `/cost` and `/report` shipped
  // exactly that way: listed, tappable, and mute in all three languages.
  const mute = [];
  for (const lang of LANGS) {
    for (const name of DOCUMENTED_COMMANDS) {
      const text = String(t(lang, `ctrl.help.about.${name}`));
      if (text === `ctrl.help.about.${name}`) mute.push(`${lang}/${name}`);
    }
  }
  assert.deepEqual(mute, [], `no hint in /help <command>: ${mute.join(', ')}`);
});

test('every documented command sits in a /help group', () => {
  // A hint with no group is a command that explains itself and cannot be found
  // by scrolling `/help` — `/endpoint` was in the list and in no section.
  const src = readFileSync(join(ROOT, 'chat', 'help-explain.mjs'), 'utf8');
  const block = src.slice(src.indexOf('const SECTION = {'), src.indexOf('};', src.indexOf('const SECTION = {')));
  const grouped = new Set([...block.matchAll(/([a-z][a-z-]*)\s*:/g)].map((m) => m[1]));
  const orphans = DOCUMENTED_COMMANDS.filter((name) => !grouped.has(name));
  assert.deepEqual(orphans, [], `not in any /help group: ${orphans.join(', ')}`);
});

test('advice never names a command the bot would refuse', () => {
  // The failure strings are read at the worst possible moment: the turn has just
  // died and the person is looking for the way out. A command named there is an
  // instruction, so it has to work. The context-overflow messages told the reader
  // to run `/compact` — which the desktop profile mounts and the headless profile
  // that actually serves Telegram does not — so the one line meant to rescue the
  // turn answered "unknown command" instead.
  //
  // Only a slash in command position counts: at the start of a line or after
  // whitespace or an opening bracket. A looser pattern reads `on/off`, a
  // `~/…/cordis.patch.yml` path and a `</file>` marker as commands, and a guard
  // that cries wolf is a guard somebody deletes.
  const atCommandPosition = (text) => [...new Set(
    [...text.matchAll(/(?:^|[\s([«"—])\/([a-z][a-z-]{1,20})\b/gm)].map((m) => m[1]),
  )];
  const advice = [];
  for (const lang of LANGS) {
    for (const root of ['core', 'ctrl']) {
      const src = readFileSync(join(ROOT, 'i18n', lang, `${root}.mjs`), 'utf8');
      for (const name of atCommandPosition(src)) {
        if (!known.has(name)) advice.push(`${lang}/${root}: /${name}`);
      }
    }
  }
  assert.deepEqual([...new Set(advice)], [],
    `user-facing strings point at commands the dispatcher does not know: ${[...new Set(advice)].join(', ')}`);
});