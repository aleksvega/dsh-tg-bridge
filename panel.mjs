// The live turn panel: the single message the bridge edits while a turn runs.
//
// Kept out of bridge.mjs so it can be imported and tested without starting the
// bot (importing the bridge claims the pid file and exits when another instance
// is alive).
import { t } from './i18n.mjs';

/** Escape the four characters Telegram's HTML parser treats as markup. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Unit of the elapsed clock in each language. */
function secondsUnit(lang) {
  return lang === 'en' ? 's' : lang === 'zh' ? '秒' : 'с';
}

/** How much of the reasoning stream the panel keeps; the tail is the useful end. */
const THINKING_MAX = 2400;
/** Telegram rejects a message over 4096 characters; the rest needs room too. */
const PANEL_MAX = 3900;

/**
 * One status message per turn, rewritten in place.
 *
 * `thinking` is the model's reasoning for this turn. It sits inside Telegram's
 * native `<blockquote expandable>`: collapsed it is one line, tapped it shows
 * the whole trail, and it never floods the chat. `plain` is the same content
 * without markup, for the fallback path when the parser refuses a message.
 */
export function progressPanel({
  lang = 'ru', seconds = 0, final = false, steps = [], thoughts = [], thinking = '', cache = '',
} = {}) {
  const head = final
    ? `✅ ${t(lang, 'status.done')} · ${seconds} ${secondsUnit(lang)}`
    : `⏳ ${t(lang, 'status.working')}… ${seconds} ${secondsUnit(lang)}`;
  const mind = thoughts.map((line) => `💭 ${line}`);
  // Three recent steps is enough to see the shape of the work; six lines of
  // shell commands read as noise on a phone.
  const tail = steps.slice(-3).map((line) => `• ${line}`);
  const more = steps.length > 3 ? t(lang, 'status.more', { n: steps.length - 3 }) : '';
  const fixed = [head, ...mind, ...tail, more, cache].filter(Boolean).join('\n').length;
  const room = Math.max(400, Math.min(THINKING_MAX, PANEL_MAX - fixed - 80));
  let body = String(thinking || '').trim();
  let cut = false;
  if (body.length > room) {
    body = body.slice(-room);
    cut = true;
  }
  const label = `🧠 ${t(lang, 'status.thinkTitle')}${cut ? ` · ${t(lang, 'status.thinkCut')}` : ''}`;
  const html = [
    head,
    ...mind.map((line) => escapeHtml(line)),
    body ? `<blockquote expandable>${escapeHtml(label)}\n${escapeHtml(body)}</blockquote>` : '',
    ...tail.map((line) => escapeHtml(line)),
    escapeHtml(more),
    escapeHtml(cache),
  ].filter(Boolean).join('\n');
  const plain = [
    head,
    ...mind,
    body ? `${label}\n${body}` : '',
    ...tail,
    more,
    cache,
  ].filter(Boolean).join('\n');
  return { html, plain };
}
