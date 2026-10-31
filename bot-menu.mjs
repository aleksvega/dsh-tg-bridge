// dsh-bot-menu — install the Telegram command menu that matches THIS bridge.
//
// Why it exists: the menu the person sees is whatever `setMyCommands` last
// wrote, and another plugin (@xmanrui/dsh-im) had set a Chinese list of 31
// commands that this bridge does not implement. A menu that lies is worse than
// no menu, so the bridge owns its own list and re-asserts it on start.
//
// What it publishes comes from `MENU_COMMANDS` in `commands-registry.mjs`, not
// from a second list kept here. That second list is how `/task` stayed in the
// menu for a release after `/task` had become an alias: the registry said one
// thing, the menu said another, and both were "the source of truth".
//
// "Re-asserts it on start" used to be a comment and nothing else: the install
// ran only from `init`/`setup`, so any later plugin that wrote its own list kept
// it until somebody ran this file by hand. `bridge.mjs` calls `installMenu()`
// once per start for that reason.
//
// Usage: node bot-menu.mjs [--delete]

import { pathToFileURL } from 'node:url';
import { MENU_COMMANDS } from './chat/commands-registry.mjs';
import { LANGS, t } from './core/i18n.mjs';
import { findToken } from './core/secrets.mjs';

/** The menu rows for one language, straight from the registry. */
export function rows(lang) {
  return MENU_COMMANDS.map((name) => ({
    // Telegram caps a description at 256 characters and a name at 32; an
    // over-long row makes the whole call fail, so the cut happens here once.
    command: name,
    description: String(t(lang, `menu.cmd.${name}`)).slice(0, 256),
  }));
}

function botToken() {
  return findToken();
}

/**
 * Publish the registry's menu for every language we speak, then read it back.
 *
 * Returns what actually landed, so a caller can log one honest line instead of
 * assuming a `setMyCommands` it never checked. A language Telegram refuses is
 * reported and skipped: one refusal must not leave the others unset.
 */
export async function installMenu({ call, log = () => {}, token = findToken() } = {}) {
  const api = call || ((method, body) => telegram(token, method, body));
  await api('setMyCommands', { commands: rows('ru') });
  const languages = ['ru'];
  const failed = [];
  // Telegram validates language_code against its own ISO list: 'zh-hans' is
  // rejected with "invalid language code", 'zh' is accepted.
  for (const code of LANGS.filter((lang) => lang !== 'ru')) {
    try {
      await api('setMyCommands', { commands: rows(code), language_code: code });
      languages.push(code);
    } catch (error) {
      failed.push(code);
      log(`menu for ${code} failed: ${error.message}`);
    }
  }
  const check = await api('getMyCommands', {});
  return {
    languages,
    failed,
    count: Array.isArray(check) ? check.length : 0,
    rows: Array.isArray(check) ? check : [],
  };
}

async function telegram(token, method, body) {
  if (!token) throw new Error('bot token not found in ~/.dsh/.credentials.yaml');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`${method}: ${json.description || res.status}`);
  return json.result;
}

export async function deleteMenu({ call, token = findToken() } = {}) {
  const api = call || ((method, body) => telegram(token, method, body));
  await api('deleteMyCommands', {});
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const token = findToken();
  if (!token) {
    console.error('bot token not found in ~/.dsh/.credentials.yaml');
    process.exit(1);
  }
  if (args.has('--delete')) {
    await deleteMenu({ token });
    console.log('menu deleted');
    return;
  }
  const result = await installMenu({ token, log: (line) => console.error(line) });
  for (const code of result.languages) console.log(`menu installed for ${code}: ${MENU_COMMANDS.length} commands`);
  console.log(`menu installed: ${result.count} commands`);
  for (const c of result.rows) console.log(`  /${c.command} — ${c.description}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}