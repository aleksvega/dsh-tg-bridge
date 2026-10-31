// The Telegram menu is the first thing a person scrolls, and it used to be a
// wall: thirty-six rows, including pairs one letter apart (`task` / `tasks`,
// `sessions` / `resume`) that the registry had already decided were one command.
// These tests keep the menu a menu: short, honest, and built from the registry
// rather than from a second list that can drift.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMAND_ALIASES, DOCUMENTED_COMMANDS, MENU_COMMANDS } from '../chat/commands-registry.mjs';
import { LANGS, t } from '../core/i18n.mjs';
import { installMenu } from '../bot-menu.mjs';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the menu is short enough to read on a phone', () => {
  assert.ok(MENU_COMMANDS.length <= 16, `the menu has ${MENU_COMMANDS.length} rows`);
  assert.ok(MENU_COMMANDS.length >= 8, 'a menu that hides everything is not a menu either');
});

test('every row is a documented command, never an alias', () => {
  for (const name of MENU_COMMANDS) {
    assert.ok(DOCUMENTED_COMMANDS.includes(name), `${name} is not a documented command`);
    assert.equal(COMMAND_ALIASES[name], undefined, `${name} is an alias and must not be advertised`);
  }
});

test('no row is another row with an s on the end', () => {
  // The complaint that started this: `task`/`tasks` in one list reads as a typo,
  // not as two commands. A row pair that differs only by a plural ending is the
  // same mistake in a new place.
  const set = new Set(MENU_COMMANDS);
  for (const name of MENU_COMMANDS) {
    assert.ok(!set.has(`${name}s`), `${name} and ${name}s are both in the menu`);
    if (name.endsWith('s')) {
      assert.ok(!set.has(name.slice(0, -1)), `${name} duplicates its singular`);
    }
  }
});

test('every row is named once', () => {
  assert.equal(new Set(MENU_COMMANDS).size, MENU_COMMANDS.length);
});

test('every row has a real description in every language', () => {
  for (const lang of LANGS) {
    for (const name of MENU_COMMANDS) {
      const text = String(t(lang, `menu.cmd.${name}`));
      assert.ok(!text.startsWith('menu.cmd.'), `${lang} has no description for ${name}`);
      assert.ok(text.length > 5 && text.length <= 256, `${lang}/${name} is ${text.length} characters`);
    }
  }
});

test('the published menu is built from the registry, not from a second list', () => {
  const source = readFileSync(join(here, 'bot-menu.mjs'), 'utf8');
  assert.match(source, /import \{ MENU_COMMANDS \} from '\.\/(?:chat\/)?commands-registry\.mjs'/, 'bot-menu must read MENU_COMMANDS');
  // A hardcoded row array here is how `/task` outlived its alias.
  assert.doesNotMatch(source, /\{\s*command:\s*'/, 'no command rows may be written by hand in bot-menu.mjs');
});

test('the bridge re-asserts the menu on start, and a refusal is not fatal', async () => {
  // `setMyCommands` is global state: any plugin can overwrite it after the
  // install, and one did (31 Chinese rows this bridge cannot run). Claiming the
  // menu "on start" was a comment with no caller until this test existed.
  const source = readFileSync(join(here, 'bridge.mjs'), 'utf8');
  assert.match(source, /import \{ installMenu \} from '\.\/bot-menu\.mjs'/, 'bridge must import installMenu');
  assert.match(source, /await installMenu\(\{ log \}\)/, 'startup must call it');
  const at = source.indexOf('await installMenu(');
  const around = source.slice(Math.max(0, at - 500), at + 500);
  assert.match(around, /catch \(error\) \{\s*log\(`menu assert failed/, 'a failed menu must be logged, not thrown');
});

test('installMenu publishes every language and reports what landed', async () => {
  const calls = [];
  const call = async (method, body) => {
    calls.push({ method, body });
    if (method === 'getMyCommands') return Array.from({ length: MENU_COMMANDS.length }, (_, i) => ({ command: MENU_COMMANDS[i], description: 'x' }));
    return true;
  };
  const result = await installMenu({ call });
  assert.deepEqual(result.languages, ['ru', ...LANGS.filter((lang) => lang !== 'ru')]);
  assert.deepEqual(result.failed, []);
  assert.equal(result.count, MENU_COMMANDS.length);
  const languages = calls.filter((c) => c.method === 'setMyCommands').map((c) => c.body.language_code || 'ru');
  assert.equal(languages[0], 'ru', 'the default scope goes first');
  for (const lang of LANGS) assert.ok(languages.includes(lang), `${lang} was never published`);
});

test('one language Telegram refuses does not leave the others unset', async () => {
  const seen = [];
  const call = async (method, body) => {
    if (method === 'setMyCommands' && body.language_code === 'zh') throw new Error('Bad Request: invalid language code');
    if (method === 'setMyCommands') seen.push(body.language_code || 'ru');
    return method === 'getMyCommands' ? [] : true;
  };
  const lines = [];
  const result = await installMenu({ call, log: (line) => lines.push(line) });
  assert.deepEqual(result.failed, ['zh']);
  assert.ok(seen.includes('en'), 'the English install must still have happened');
  assert.match(lines[0], /menu for zh failed/);
});