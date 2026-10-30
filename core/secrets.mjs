// Secrets: the bot token and the provider keys this install needs.
//
// Everything here reads `~/.dsh/.credentials.yaml`, which the desktop app also
// writes, so the bridge never keeps a second copy of a secret. Nothing in this
// file logs a value — only whether one was found.
import { readFileSync } from 'node:fs';
import { CRED } from './paths.mjs';

/** One `name: value` entry from the credentials file. Throws if the file is gone. */
export function readSecret(name) {
  const yaml = readFileSync(CRED, 'utf8');
  const re = new RegExp(`^\\s*${name}:\\s*["']?([^"'\\s]+)`, 'm');
  const m = yaml.match(re);
  return m ? m[1] : '';
}

/**
 * Env vars for the provider keys this install needs.
 *
 * A headless turn inherits the bridge's environment, and the credentials
 * service only resolves providers the app knows about. Extra providers are
 * therefore declared per install in `config.json` as
 * `"providerKeys": ["MY_PROVIDER_API_KEY"]`, and each name is read from
 * `~/.dsh/.credentials.yaml` under the same name. Nothing is hardcoded: an
 * install that runs on the app's own providers sets an empty list and gets
 * exactly the inherited environment.
 */
export function providerKeys(cfg) {
  const out = {};
  const names = Array.isArray(cfg?.providerKeys) ? cfg.providerKeys : [];
  for (const name of names) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(String(name))) continue;
    try {
      const value = readSecret(name) || (process.env[name] || '').trim();
      if (value) out[name] = value;
    } catch {}
  }
  return out;
}

/**
 * The bot token can be stored under three names: the plain one that `dsh-tg
 * init` writes, the suffixed one DSH generates when the secret is added through
 * the app, or an env var. Checking only the suffixed name made a fresh install
 * fail with "token not found" even though init had just written it.
 */
export function findToken() {
  const env = (process.env.DSH_TELEGRAM_BOT_TOKEN || '').trim();
  if (env) return env;
  // The suffixed name carries a random id of the machine that created the
  // secret (DSH_TELEGRAM_BOT_TOKEN_<hex>), so it must not be spelled out here:
  // any install is free to carry its own suffix. Try the plain name first, then
  // whatever suffixed variants the credentials file actually holds.
  const suffixes = [];
  try {
    for (const m of readFileSync(CRED, 'utf8').matchAll(/^\s*(DSH_TELEGRAM_BOT_TOKEN_[A-Z0-9_]+):/gm)) suffixes.push(m[1]);
  } catch {}
  for (const name of ['DSH_TELEGRAM_BOT_TOKEN', ...suffixes]) {
    try {
      const value = readSecret(name);
      if (value) return value;
    } catch {}
  }
  try {
    const m = readFileSync(CRED, 'utf8').match(/^\s*(DSH_TELEGRAM_BOT_TOKEN[A-Z0-9_]*):\s*["']?([^"'\s]+)/m);
    if (m) return m[2];
  } catch {}
  return '';
}

/**
 * The token, resolved once at import.
 *
 * Resolved here rather than at each call site because every URL is built from
 * it, and a call site that re-read the file would pick up a rotated token in the
 * middle of a turn. A missing token is not fatal *in this module*: the entry
 * point decides what to do about it, so importing the module from a test cannot
 * exit the process.
 */
export const token = findToken();
