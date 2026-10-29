// How full the context is, while the turn is still running.
//
// A turn dies at the ceiling of its model's context window, and the death is
// expensive in the worst way: the prompt that hit the wall is re-sent, billed,
// and rejected. `/status` could already say how big the context was — after the
// fact. This module answers the same question during the turn, so the card can
// say "почти полный" while there is still room to do something about it.
//
// The number is not a guess. The CLI's `status` events carry the provider's own
// `usage`, and the window is the one the profile declares (`windowOf`). What
// this module refuses to do is invent either: with no usage, or no window, it
// says nothing rather than a percentage of an unknown.
import { t } from './i18n.mjs';

/** The levels a meter can be in. `warn` is a hint, `full` is a last chance. */
export const WARN_PCT = 75;
export const FULL_PCT = 90;

/**
 * How full a context is.
 *
 * `used` is the prompt the last request sent, which is what the window is
 * measured against — not the lifetime total, which grows forever and would read
 * as "полный" on a healthy long session.
 *
 * @param {{used: number, limit: number}} input
 * @returns {{used: number, limit: number, pct: number, level: 'ok'|'warn'|'full'} | null}
 */
export function contextFill({ used, limit } = {}) {
  const u = Number(used);
  const l = Number(limit);
  if (!Number.isFinite(u) || u <= 0) return null;
  if (!Number.isFinite(l) || l <= 0) return null;
  const pct = Math.min(100, Math.round((u / l) * 100));
  const level = pct >= FULL_PCT ? 'full' : pct >= WARN_PCT ? 'warn' : 'ok';
  return { used: Math.round(u), limit: Math.round(l), pct, level };
}

/**
 * The context the last request actually carried.
 *
 * `totalTokens` is the provider's own sum of prompt + cache read, so it is used
 * when present; older providers report only the two parts, and adding them is
 * the same number. `outputTokens` is deliberately absent: it is the answer being
 * written, not what the window holds yet.
 *
 * @param {{inputTokens?: number, cacheReadTokens?: number, totalTokens?: number}} usage
 */
export function contextUsed(usage) {
  if (!usage) return 0;
  if (Number.isFinite(usage.totalTokens) && usage.totalTokens > 0) return usage.totalTokens;
  const input = Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
  const cache = Number.isFinite(usage.cacheReadTokens) ? usage.cacheReadTokens : 0;
  return input + cache;
}

/**
 * A short token count: `812k`, `1.2M`, `950`.
 *
 * A five-digit number in a one-line card is noise; the person needs the order of
 * magnitude, and the exact figure is in `/status`.
 */
export function shortTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

/**
 * The row the card shows, or '' when there is nothing honest to say.
 *
 * @param {{used: number, limit: number}} input
 * @param {string} lang
 */
export function contextRow(input, lang = 'en') {
  const fill = contextFill(input);
  if (!fill) return '';
  const vars = { used: shortTokens(fill.used), limit: shortTokens(fill.limit), pct: fill.pct };
  if (fill.level === 'full') return t(lang, 'status.contextFull', vars);
  if (fill.level === 'warn') return t(lang, 'status.contextWarn', vars);
  return t(lang, 'status.contextRow', vars);
}
