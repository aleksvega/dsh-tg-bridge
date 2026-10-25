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

/** How much of the reasoning stream a block keeps; the tail is the useful end. */
const THINKING_MAX = 2000;
/** Telegram rejects a message over 4096 characters; the rest needs room too. */
const PANEL_MAX = 3900;
/** Steps stay short lines, so a long turn can show all of them. */
const STEPS_MAX = 1600;

/** Collapse `text` to its tail, saying so when something was dropped. */
function tailOf(text, room) {
  if (text.length <= room) return { text, cut: false };
  return { text: text.slice(-room), cut: true };
}

/**
 * One status message per turn, rewritten in place.
 *
 * Long content lives in Telegram's native `<blockquote expandable>`: collapsed it
 * is one line, tapped it shows the whole trail, and it never floods the chat. Two
 * blocks at most — the model's reasoning and, when a turn makes more than three
 * tool calls, the full step list — so the chat still reads as one message per
 * turn. `plain` is the same content without markup, for the fallback path when
 * the parser refuses a message and for `plainText` installs.
 */
export function progressPanel({
  lang = 'ru', seconds = 0, final = false, steps = [], thoughts = [], thinking = '', cache = '',
} = {}) {
  const head = final
    ? `✅ ${t(lang, 'status.done')} · ${seconds} ${secondsUnit(lang)}`
    : `⏳ ${t(lang, 'status.working')}… ${seconds} ${secondsUnit(lang)}`;
  const mind = thoughts.map((line) => `💭 ${line}`);
  const base = [head, ...mind, cache].filter(Boolean).join('\n').length;

  // Up to three steps fit inline and read better there; a longer turn would turn
  // the panel into a wall of shell commands, so its steps move into a block.
  const many = steps.length > 3;
  const inline = many ? [] : steps.map((line) => `• ${line}`);
  const stepsRoom = Math.max(0, Math.min(STEPS_MAX, PANEL_MAX - base - 1200));
  const all = many
    ? tailOf(steps.map((line) => `• ${line}`).join('\n'), stepsRoom)
    : { text: '', cut: false };
  const stepsLabel = `🛠 ${t(lang, 'status.stepsTitle')} · ${steps.length}`
    + `${all.cut ? ` · ${t(lang, 'status.thinkCut')}` : ''}`;

  const fixed = base + inline.join('\n').length + all.text.length + 120;
  const room = Math.max(400, Math.min(THINKING_MAX, PANEL_MAX - fixed));
  const body = tailOf(String(thinking || '').trim(), room);
  const thinkLabel = `🧠 ${t(lang, 'status.thinkTitle')}${body.cut ? ` · ${t(lang, 'status.thinkCut')}` : ''}`;

  const html = [
    head,
    ...mind.map((line) => escapeHtml(line)),
    body.text ? `<blockquote expandable>${escapeHtml(thinkLabel)}\n${escapeHtml(body.text)}</blockquote>` : '',
    ...inline.map((line) => escapeHtml(line)),
    all.text ? `<blockquote expandable>${escapeHtml(stepsLabel)}\n${escapeHtml(all.text)}</blockquote>` : '',
    escapeHtml(cache),
  ].filter(Boolean).join('\n');
  const plain = [
    head,
    ...mind,
    body.text ? `${thinkLabel}\n${body.text}` : '',
    ...inline,
    all.text ? `${stepsLabel}\n${all.text}` : '',
    cache,
  ].filter(Boolean).join('\n');
  return { html, plain };
}
