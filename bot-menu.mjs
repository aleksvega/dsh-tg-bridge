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
// Usage: node bot-menu.mjs [--delete]

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { MENU_COMMANDS } from './commands-registry.mjs';
import { LANGS, t } from './i18n.mjs';

const args = new Set(process.argv.slice(2));

const token = (() => {
  const env = (process.env.DSH_TELEGRAM_BOT_TOKEN || '').trim();
  if (env) return env;
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh');
    const yaml = readFileSync(join(home, '.credentials.yaml'), 'utf8');
    // `dsh-tg init` writes the plain name; the DSH app adds a random suffix.
    const m = /^\s*(DSH_TELEGRAM_BOT_TOKEN[A-Z0-9_]*):\s*["']?([^"'\s]+)/m.exec(yaml);
    return m ? m[2] : '';
  } catch {
    return '';
  }
})();

/** The menu rows for one language, straight from the registry. */
function rows(lang) {
  return MENU_COMMANDS.map((name) => ({
    // Telegram caps a description at 256 characters and a name at 32; an
    // over-long row makes the whole call fail, so the cut happens here once.
    command: name,
    description: String(t(lang, `menu.cmd.${name}`)).slice(0, 256),
  }));
}

async function api(method, body) {
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

async function main() {
  if (!token) {
    console.error('bot token not found in ~/.dsh/.credentials.yaml');
    process.exit(1);
  }
  if (args.has('--delete')) {
    await api('deleteMyCommands', {});
    console.log('menu deleted');
    return;
  }
  // The default list is the language the owner reads; the others are installed
  // per language_code so an English or Chinese phone sees its own words.
  await api('setMyCommands', { commands: rows('ru') });
  // Telegram validates language_code against its own ISO list: 'zh-hans' is
  // rejected with "invalid language code", 'zh' is accepted. Each language is
  // installed independently — one refusal must not leave the others unset.
  for (const code of LANGS.filter((lang) => lang !== 'ru')) {
    try {
      await api('setMyCommands', { commands: rows(code), language_code: code });
      console.log(`menu installed for ${code}: ${MENU_COMMANDS.length} commands`);
    } catch (error) {
      console.error(`menu for ${code} failed: ${error.message}`);
    }
  }
  const check = await api('getMyCommands', {});
  console.log(`menu installed: ${check.length} commands`);
  for (const c of check) console.log(`  /${c.command} — ${c.description}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});