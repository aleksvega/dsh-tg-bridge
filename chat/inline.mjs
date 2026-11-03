// Inline mode: `@bot rew` answers with the commands whose name starts with rew.
//
// Telegram has no way to put text into somebody's input box from an inline
// result: picking one sends a message. So a result posts the usage line itself,
// written without the leading slash, and the poller drops anything that arrives
// through the bot (`via_bot`). Together those two make the promise true — inline
// mode runs nothing — instead of hoping the person does not tap.
//
// What a result says comes from the same table `/help` reads, in the language of
// this install rather than of the requester: the answer is built from the
// registry only, so a stranger who found the bot inline learns the command names
// and nothing about any chat, and every requester gets the same list.
import { CONTROL_COMMANDS } from './commands-registry.mjs';
import { HELP_COVERED, sectionFor } from './help-sections.mjs';
import { currentBotUsername } from './commands.mjs';
import { resolveLang, t } from '../core/i18n.mjs';

/** Telegram's own ceiling for inline results, and its row description width. */
const MAX_RESULTS = 20;
const MAX_DESCRIPTION = 100;

/** The sentence /help gives for one command, flattened for a result row. */
export function aboutCommand(name, lang) {
  const about = t(lang, `ctrl.help.about.${name}`);
  const text = about && !about.startsWith('ctrl.help.about.') ? about : t(lang, `help.section.${sectionFor(name)}`);
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > MAX_DESCRIPTION ? `${flat.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…` : flat;
}

/** What a chosen result posts: the syntax, deliberately not a command. */
export const hintText = (name, lang) => `${name} — ${aboutCommand(name, lang)}`;

/** Results for a prefix, at most twenty, in registry order. */
export function inlineResults(prefix, lang) {
  const typed = String(prefix || '').trim().toLowerCase().replace(/^\//, '');
  const pool = typed ? CONTROL_COMMANDS.filter((c) => c.startsWith(typed)) : HELP_COVERED;
  return pool.slice(0, MAX_RESULTS).map((name) => ({
    type: 'article',
    id: name,
    title: `/${name}`,
    description: aboutCommand(name, lang),
    input_message_content: { message_text: hintText(name, lang), disable_web_page_preview: true },
  }));
}

/**
 * The `answerInlineQuery` arguments for one query.
 *
 * Nothing matched gets the hub button instead of an empty list: a bare bot name
 * is a person asking "what can you do", and a blank dropdown answers nothing.
 */
export function inlinePayload(text, lang) {
  const results = inlineResults(text, lang);
  const base = { results, cache_time: 300, is_personal: false };
  if (results.length) return base;
  return { ...base, switch_pm_text: t(lang, 'ctrl.inline.hub'), switch_pm_parameter: 'help' };
}

/** A message the person sent by picking one of our own inline results. */
export function sentThroughUs(message) {
  const mine = currentBotUsername();
  const via = String(message?.via_bot?.username || '');
  return Boolean(mine) && via.toLowerCase() === mine.toLowerCase();
}

/**
 * Take one `inline_query` update: move the offset past it (there is nothing to
 * journal — an inline answer is a list of hints, read once) and answer it. A
 * failure is logged, never surfaced as a turn.
 */
export async function takeInlineQuery({ update, tg, state, config, log, save }) {
  state.offset = Math.max(state.offset, update.update_id + 1);
  save();
  const lang = resolveLang(state, null, null, config);
  try {
    await tg('answerInlineQuery', { inline_query_id: update.inline_query.id, ...inlinePayload(update.inline_query.query, lang) });
  } catch (error) {
    log(`inline answer failed: ${error.message}`);
  }
}