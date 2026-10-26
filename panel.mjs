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
 * One line for a tool call in the panel.
 *
 * The harness runs every call in a fresh shell, so most commands start with
 * `cd <dir>`; that prefix says nothing about the work. Strip it (and the shell
 * wrapper) and keep the statement that does something, with its arguments — a
 * list of bare verbs (`pwsh: cd`, `pwsh: node`) is what made the panel read as
 * noise. A call that only changed directory returns '' and is not shown.
 */
export function stepLine(event) {
  const tool = event.tool || 'tool';
  const input = event.input ?? {};
  const pick = input.command ?? input.description ?? input.file_path ?? input.path
    ?? input.pattern ?? input.query ?? input.url ?? '';
  let text = String(pick).replace(/\r?\n/g, ' ; ').replace(/\s+/g, ' ').trim();
  if (input.command) {
    text = text.replace(/^(pwsh|powershell|cmd|bash)(\.exe)?\s+(-\S+\s+)*/i, '');
    text = text.replace(/^(cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*)+/i, '');
    text = text.replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*$/i, '').trim();
    text = text.replace(/\s*(?:&&|;|\|\|)\s*[\s\S]*$/, '').trim();
    if (!text) return '';
  }
  return `${tool}: ${text.slice(0, 64)}`;
}

/** Push a step, folding a repeat into the line above it: `×3`, not three rows. */
export function addStep(steps, line) {
  if (!line) return steps;
  const at = steps.length - 1;
  const prev = at >= 0 ? /^(.*) ×(\d+)$/.exec(steps[at]) : null;
  if (at >= 0 && steps[at] === line) {
    steps[at] = `${line} ×2`;
    return steps;
  }
  if (prev && prev[1] === line) {
    steps[at] = `${line} ×${Number(prev[2]) + 1}`;
    return steps;
  }
  steps.push(line);
  return steps;
}

/**
 * One status message per turn, rewritten in place.
 *
 * Long content lives in Telegram's native `<blockquote expandable>`: collapsed it
 * is one line, tapped it shows the whole trail, and it never floods the chat. Two
 * blocks at most — the model's reasoning and, when a turn makes more than three
 * tool calls, the full step list. They appear only in the final edit (`final`):
 * Telegram re-collapses an expanded block on every edit of its message, so a live
 * edit that carried blocks would yank the chat away from whoever is reading one.
 * `plain` is the same content without markup, for the fallback path when
 * the parser refuses a message and for `plainText` installs.
 */
export function progressPanel({
  lang = 'ru', seconds = 0, final = false, steps = [], thoughts = [], thinking = '', cache = '',
  // `counter` keeps the reasoning out of the chat: a number in the panel, the
  // log itself in the file that `/thoughts file` sends.
  reasoning = 'block',
  // The person's own request, echoed back in the head. The panel is the first
  // thing sent after a message arrives, so this is what makes that first
  // message say "принял: …" instead of a generic spinner.
  task = '',
  // Which settings this topic actually overrides, e.g. "Reviewer · glm-5.3/high".
  // It rides in the head, so the panel budget above counts it automatically.
  chip = '',
  // The forum topic this card belongs to, already translated by the caller. A
  // group can run two topics at once and the cards look identical; the head is
  // the only part that survives the card being quoted or forwarded.
  topic = '',
} = {}) {
  const snippet = String(task).replace(/\s+/g, ' ').trim().slice(0, 48);
  const mark = String(chip).trim() ? ` · ${String(chip).trim()}` : '';
  const where = String(topic || '').trim() ? `\n${String(topic).trim()}` : '';
  const head = final
    ? `✅ ${t(lang, 'status.done')} · ${seconds} ${secondsUnit(lang)}${mark}${where}`
    : snippet
      ? `⏳ ${t(lang, 'status.accepted')}: «${snippet}${String(task).trim().length > 48 ? '…' : ''}» · ${seconds} ${secondsUnit(lang)}${mark}${where}`
      : `⏳ ${t(lang, 'status.working')}… ${seconds} ${secondsUnit(lang)}${mark}${where}`;
  const mind = thoughts.map((line) => `💭 ${line}`);
  const base = [head, ...mind, cache].filter(Boolean).join('\n').length;

  // While the turn runs this message is rewritten every few seconds, and
  // Telegram drops an expanded block on every edit — which is what yanks the
  // chat away from someone mid-sentence. So a live edit stays short: the last
  // steps inline, a counter instead of the reasoning, no collapsible content at
  // all. The two blocks arrive once, in the final edit, which nothing touches
  // again, so a block can be opened and read in peace.
  const many = steps.length > 3;
  const inline = many
    ? (final ? [] : steps.slice(-3).map((line) => `• ${line}`))
    : steps.map((line) => `• ${line}`);
  const more = !final && many ? t(lang, 'status.more', { n: steps.length - 3 }) : '';
  const text = String(thinking || '').trim();
  const live = (reasoning === 'counter' && final)
    ? (text ? `🧠 ${t(lang, 'status.thinkTitle')} · ${text.length} · /thoughts file` : '')
    : (!final && text ? `🧠 ${t(lang, 'status.thinkTitle')} · ${text.length}` : '');
  const stepsRoom = Math.max(0, Math.min(STEPS_MAX, PANEL_MAX - base - 1200));
  const all = many && final
    ? tailOf(steps.map((line) => `• ${line}`).join('\n'), stepsRoom)
    : { text: '', cut: false };
  const stepsLabel = `🛠 ${t(lang, 'status.stepsTitle')} · ${steps.length}`
    + `${all.cut ? ` · ${t(lang, 'status.thinkCut')}` : ''}`;

  // The block's own label can carry the cut suffix, so it has to be budgeted too.
  const labelRoom = `🧠 ${t(lang, 'status.thinkTitle')} · ${t(lang, 'status.thinkCut')} · /thoughts file\n`.length;
  const fixed = base + inline.join('\n').length + all.text.length + more.length + live.length + labelRoom + 120;
  const room = Math.max(400, Math.min(THINKING_MAX, PANEL_MAX - fixed));
  const body = final && reasoning === 'block' ? tailOf(text, room) : { text: '', cut: false };
  // A cut block starts mid-sentence; say so and point at the one command that
  // still has the whole text, otherwise the reasoning reads as broken.
  const thinkLabel = `🧠 ${t(lang, 'status.thinkTitle')}`
    + `${body.cut ? ` · ${t(lang, 'status.thinkCut')} · /thoughts file` : ''}`;

  const html = [
    head,
    ...mind.map((line) => escapeHtml(line)),
    escapeHtml(live),
    body.text ? `<blockquote expandable>${escapeHtml(thinkLabel)}\n${escapeHtml(body.text)}</blockquote>` : '',
    ...inline.map((line) => escapeHtml(line)),
    escapeHtml(more),
    all.text ? `<blockquote expandable>${escapeHtml(stepsLabel)}\n${escapeHtml(all.text)}</blockquote>` : '',
    escapeHtml(cache),
  ].filter(Boolean).join('\n');
  const plain = [
    head,
    ...mind,
    live,
    body.text ? `${thinkLabel}\n${body.text}` : '',
    ...inline,
    more,
    all.text ? `${stepsLabel}\n${all.text}` : '',
    cache,
  ].filter(Boolean).join('\n');
  return { html, plain };
}
