// The failover card: the chain as a person can see it and change it.
//
// Why a card and not a config key: `fallbackModels` was invisible from the chat,
// so the only way to learn whether a failover would ever happen was to open
// config.json on the machine — and the honest answer to "why did it not switch"
// was often "nothing was configured to switch to". A numbered list with a button
// per route answers both questions, and the numbering is 1-based because it is
// what the person types next.
//
// This module renders; `control/cmd-fallback.mjs` changes. Keeping the two apart
// is what lets `/report` show the same lines without a second formatter.
import { existsSync } from 'node:fs';
import { labelOf } from './fallback.mjs';

/** Telegram's ceiling on callback payloads. */
const MAX_PAYLOAD = 64;

export const FALLBACK_PREFIX = 'fb:';

export function isFallbackPress(value) {
  return String(value || '').startsWith(FALLBACK_PREFIX);
}

/** A payload the router accepts: `fb:<verb>` or `fb:<verb>:<n>`. */
function press(verb, n = 0) {
  const data = n ? `${FALLBACK_PREFIX}${verb}:${n}` : `${FALLBACK_PREFIX}${verb}`;
  if (data.length > MAX_PAYLOAD) throw new Error(`payload too long: ${data}`);
  return data;
}

/** `fb:u:3` → `{ verb: 'u', n: 3 }`; anything else is null, never a throw. */
export function pressTarget(data) {
  const text = String(data || '');
  if (!text.startsWith(FALLBACK_PREFIX)) return null;
  const [verb = '', raw = ''] = text.slice(FALLBACK_PREFIX.length).split(':');
  if (!verb) return null;
  const n = Number(raw);
  return { verb, n: Number.isInteger(n) && n > 0 ? n : 0 };
}

/**
 * Whether a route can actually be started.
 *
 * A missing overlay is the failure this guards: the entry sits in the chain, so
 * the card counted it as a route while the turn skipped it without a word. A
 * route that cannot boot is not a route, and the card says so instead of
 * counting it.
 */
export function isUsable(entry) {
  return Boolean(entry && entry.patch && existsSync(entry.patch));
}

/** The marks that change what a route is worth: free, switched off, unstartable. */
function marksOf(entry, { t }) {
  const marks = [];
  if (entry.free) marks.push(t('ctrl.fallback.free'));
  if (entry.off) marks.push(t('ctrl.fallback.off'));
  if (!isUsable(entry)) marks.push(t('ctrl.fallback.broken'));
  return marks;
}

/** `1. provider/model` plus the marks that change the answer: free, off, broken. */
export function chainLine(entry, index, { t }) {
  const marks = marksOf(entry, { t });
  const tail = marks.length ? ` · ${marks.join(' · ')}` : '';
  return `${index + 1}. ${labelOf(entry) || t('ctrl.fallback.unnamed')}${tail}`;
}

/**
 * The chain in one line, for `/report`: the count, then the routes in order.
 *
 * The report is read by a maintainer who cannot see the card, and a bare list of
 * names would hide the routes the turn skips — the very reason a report is opened.
 */
export function chainSummary(chain = [], { t }) {
  if (chain.length === 0) return t('ctrl.fallback.empty');
  const routes = chain.map((entry, index) => {
    const marks = marksOf(entry, { t });
    const tail = marks.length ? ` (${marks.join(' · ')})` : '';
    return `${index + 1}. ${labelOf(entry) || t('ctrl.fallback.unnamed')}${tail}`;
  });
  return `${describeChain(chain, { t })} — ${routes.join(' → ')}`;
}

/**
 * What the chain is worth in one line: how many routes a turn would really try.
 *
 * "7 routes" while three overlays are missing and two are switched off is the
 * kind of number that makes a person stop trusting the card, so the count is the
 * usable one and the rest is spelled out beside it.
 */
export function describeChain(chain = [], { t }) {
  if (chain.length === 0) return t('ctrl.fallback.empty');
  const live = chain.filter((entry) => isUsable(entry) && !entry.off).length;
  const off = chain.filter((entry) => entry.off).length;
  const broken = chain.filter((entry) => !isUsable(entry)).length;
  const extra = [
    off ? t('ctrl.fallback.countOff', { n: off }) : '',
    broken ? t('ctrl.fallback.countBroken', { n: broken }) : '',
  ].filter(Boolean).join(', ');
  return t('ctrl.fallback.count', { n: live, total: chain.length, extra: extra ? ` (${extra})` : '' });
}

/**
 * One row per route: the switch, then the two arrows.
 *
 * Three buttons is what fits a phone without a second card, and each carries the
 * number it acts on, so a card left on screen while the chain changed cannot move
 * a route nobody chose.
 */
export function fallbackKeyboard({ t, chain = [], enabled = true }) {
  const rows = chain.map((entry, index) => {
    const n = index + 1;
    return [
      { text: `${entry.off ? '○' : '●'} ${n}`, data: press('t', n) },
      { text: `↑ ${n}`, data: press('u', n) },
      { text: `↓ ${n}`, data: press('d', n) },
    ];
  });
  rows.push([
    { text: t('ctrl.fallback.test'), data: press('x') },
    { text: enabled ? t('ctrl.fallback.disable') : t('ctrl.fallback.enable'), data: press('e') },
  ]);
  if (chain.length > 0) rows.push([{ text: t('ctrl.fallback.remove'), data: press('r') }]);
  return rows;
}

/**
 * The whole card: the route this topic answers on, the numbered chain, what
 * starts a failover, and the buttons that change it.
 *
 * `primary` is not part of the chain, and printing it above the list is what
 * stops "why is the first model not the one I asked for".
 */
export function renderFallbackCard({ t, chain = [], primary = {}, enabled = true }) {
  const lines = [
    t('ctrl.fallback.title'),
    t('ctrl.fallback.mode', { state: enabled ? t('ctrl.fallback.on') : t('ctrl.fallback.offState') }),
  ];
  const here = labelOf(primary);
  if (here) lines.push(t('ctrl.fallback.primary', { route: here }));
  lines.push('', describeChain(chain, { t }));
  for (const [index, entry] of chain.entries()) lines.push(chainLine(entry, index, { t }));
  lines.push('', t('ctrl.fallback.triggers'), t('ctrl.fallback.notTriggers'));
  if (chain.length === 0) lines.push('', t('ctrl.fallback.addUsage'));
  lines.push('', t('ctrl.fallback.foot'));
  return { text: lines.join('\n'), keyboard: fallbackKeyboard({ t, chain, enabled }) };
}

/**
 * The remove menu: one button per route, because removing by number is a guess
 * about which number is which, and a wrong guess costs a route.
 */
export function removeKeyboard({ t, chain = [] }) {
  const rows = chain.map((entry, index) => [{
    text: `${index + 1}. ${labelOf(entry)}`,
    data: press('r', index + 1),
  }]);
  rows.push([{ text: t('ctrl.fallback.back'), data: press('s') }]);
  return rows;
}

/**
 * The answer to `/fallback test`: one line per route and the honest footnote.
 *
 * A probe proves the key works, not that the provider accepts this conversation;
 * a card that said "all routes are fine" beside a 400 would send the person to
 * the wrong fix. It also prints how long each route took to say one token: two
 * routes that both answer "ok" are not equally good, and a person picking the
 * first of the chain is choosing on speed, not on the word "ok".
 */
export function renderProbe({ t, rows = [] }) {
  const lines = [t('ctrl.fallback.testTitle')];
  for (const row of rows) {
    // Latency is printed only for a route that actually answered. "no balance ·
    // 120 ms" invites the reading "it works, it is just slow", which is the one
    // thing a dead route must never look like.
    const speed = row.kind === 'ok' && Number.isFinite(row.ms) && row.ms > 0
      ? t('ctrl.fallback.testSpeed', { ms: row.ms })
      : '';
    lines.push(t('ctrl.fallback.testLine', {
      n: row.n,
      route: row.route,
      verdict: t(`ctrl.fallback.verdict.${row.kind}`),
      speed,
    }));
  }
  // The fastest route that answered, named once: the list already shows it, but
  // the whole point of measuring is the one-line verdict a person acts on.
  const live = rows.filter((row) => row.kind === 'ok' && Number.isFinite(row.ms));
  if (live.length > 1) {
    const best = live.reduce((a, b) => (a.ms <= b.ms ? a : b));
    lines.push('', t('ctrl.fallback.testFastest', { route: best.route, ms: best.ms }));
  }
  lines.push('', t('ctrl.fallback.testHint'));
  return lines.join('\n');
}
