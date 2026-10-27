// i18n — three locales for the user-visible surfaces.
//
// Scope: everything a person sees without asking for it — the Telegram command
// menu, the live status message, turn errors and the everyday commands. Long
// explanatory texts stay in the source language until they are translated
// properly; a half-translated sentence is worse than a consistent one.
//
// Language resolution order: per-topic choice (/lang) -> config.lang -> the
// sender's Telegram language_code -> 'ru'.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from './i18n/en.mjs';
import ru from './i18n/ru.mjs';
import zh from './i18n/zh.mjs';

export const LANGS = ['en', 'ru', 'zh'];

const DICT = { en, ru, zh };

/** Telegram sends zh-hans / zh-hans-cn / zh-CN; all of them mean the same locale. */
export function normalizeLang(code) {
  const raw = String(code || '').toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('zh')) return 'zh';
  if (raw.startsWith('en')) return 'en';
  if (raw.startsWith('ru')) return 'ru';
  return '';
}

export function t(lang, key, vars = {}) {
  const table = DICT[lang] || DICT.ru;
  const text = table[key] ?? DICT.ru[key] ?? key;
  return String(text).replace(/\{(\w+)\}/g, (_, name) => (vars[name] ?? `{${name}}`));
}

/** Keys of one locale — used by the parity test, never by the bridge. */
export function keysOf(lang) {
  return Object.keys(DICT[lang] || {});
}

/** Menu rows for setMyCommands, translated per locale. */
export function menuFor(lang, commands) {
  return commands.map((c) => ({ command: c.command, description: t(lang, `menu.${c.command}`) }));
}

/**
 * The language a message is written in, from its own script.
 *
 * Only two of the three are worth detecting. Chinese is unambiguous — nobody
 * types Han characters by accident — and Russian is common enough among people
 * whose phone menu is in English. English is left to the locale, because Latin
 * letters are also French, German and every code identifier in a prompt.
 *
 * The measure is share, not count: a technical prompt mixes prose with paths,
 * `npm`, flags and digits, and the prose is still the same language. A message
 * where Han or Cyrillic is at least a quarter of the letters is that language
 * (five Han characters among a dozen English tokens measures 0.33; a fully
 * English prompt that merely cites a Cyrillic word stays near zero). A pasted
 * error alone stays under the line and changes nothing.
 */
export function detectLang(text) {
  const body = String(text || '');
  const letters = (body.match(/\p{L}/gu) || []).length;
  if (letters < 3) return '';
  const han = (body.match(/\p{Script=Han}/gu) || []).length;
  const cyrillic = (body.match(/\p{Script=Cyrillic}/gu) || []).length;
  if (han >= 3 && han / letters >= 0.25) return 'zh';
  if (cyrillic >= 3 && cyrillic / letters >= 0.25) return 'ru';
  return '';
}

/** Language for a message: topic choice, then config default, then the text, then Telegram. */
export function resolveLang(state, key, msg, config = {}) {
  const stored = state?.lang?.[key];
  const chosen = stored || config.lang;
  // A foreign user must land in English, not Russian: Telegram reports the
  // sender's own locale, and everything outside ru/zh/en falls back to en.
  //
  // The message's own script comes before that locale, because the locale is a
  // setting people leave on the default: a Chinese reader with an English phone
  // who types Chinese is asking for an answer in Chinese. Their own words are
  // the strongest evidence available, and a `/lang` choice still wins over both.
  const resolved = normalizeLang(chosen)
    || detectLang(msg?.text || msg?.caption)
    || normalizeLang(msg?.from?.language_code)
    || 'en';
  // Remember what a topic speaks the first time a real message reveals it. A
  // button press carries no message of its own, and without this the answer to
  // that press fell back to the config default (English) while the card right
  // above it was Russian. Only the first message per topic writes state.
  if (!stored && key && state && msg?.from?.language_code) {
    if (!state.lang) state.lang = {};
    state.lang[key] = resolved;
  }
  return resolved;
}
