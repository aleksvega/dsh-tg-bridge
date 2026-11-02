// The tour: what the bot can do, five cards, buttons only.
//
// The command list answers "what is the syntax"; it never answers "what is this
// for". A beginner reading twenty commands learns nothing about which one they
// need today, so the tour walks the five jobs a person actually has — a folder,
// a model, files, the turn and the way back, the switches — and each card names
// one command that starts that job, as a button.
//
// The page lives in the callback data, not in state: a card survives a restart,
// and there is nothing to keep in sync.
import { t } from '../core/i18n.mjs';
import { inlineKeyboard } from './telegram.mjs';

/** One command per card — the one a person would reach for first in that job. */
export const TRY = ['cd', 'model', 'find', 'rewind', 'menu'];

export const PAGES = TRY.length;

/**
 * The card for one step.
 *
 * @param {number} step 1-based; clamped, because a stale button must not crash.
 */
export function tourCard(step, lang) {
  const n = Math.min(Math.max(Math.trunc(step) || 1, 1), PAGES);
  const title = t(lang, `tour.${n}.title`);
  const body = t(lang, `tour.${n}.body`);
  const text = `*${title}*\n_${t(lang, 'tour.page', { n, total: PAGES })}_\n\n${body}`;
  const row = [];
  if (n > 1) row.push({ text: t(lang, 'tour.back'), data: `tr:page:${n - 1}` });
  if (n < PAGES) row.push({ text: t(lang, 'tour.next'), data: `tr:page:${n + 1}` });
  else row.push({ text: t(lang, 'tour.done'), data: 'tr:done' });
  const keyboard = [row, [{ text: t(lang, 'tour.try', { cmd: TRY[n - 1] }), data: `tr:run:${TRY[n - 1]}` }]];
  return { text, keyboard: inlineKeyboard(keyboard) };
}
