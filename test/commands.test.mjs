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
import { CONTROL_COMMANDS } from '../control.mjs';
import { LANGS, t } from '../i18n.mjs';

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
  const source = readFileSync(join(ROOT, 'bot-menu.mjs'), 'utf8');
  const declared = [...source.matchAll(/command:\s*'([a-z-]+)'/g)].map((m) => m[1]);
  assert.ok(declared.length > 20, 'menu commands not found — did bot-menu.mjs change shape?');
  const missing = [...new Set(declared)].filter((name) => !known.has(name));
  assert.deepEqual(missing, [], `the menu offers commands the bot would reject: ${missing.join(', ')}`);
});

test('every control command is documented somewhere in /help', () => {
  const documented = new Set(LANGS.flatMap((lang) => names(t(lang, 'help.body'))));
  const silent = CONTROL_COMMANDS.filter((name) => !documented.has(name));
  assert.deepEqual(silent, [], `commands a person cannot discover: ${silent.join(', ')}`);
});

test('/settings is reachable, in all three languages', () => {
  assert.ok(known.has('settings'));
  for (const lang of LANGS) assert.ok(names(t(lang, 'help.body')).includes('settings'), lang);
});