// The price catalog, kept on disk so a turn never waits for it.
//
// `prices.mjs` fetches; this file remembers. The split exists because two
// directions of import would otherwise meet in the middle: `cost.mjs` needs the
// numbers, `prices.mjs` produces them, and a cache that both import must import
// neither. It depends on nothing but the filesystem.
//
// The freshness rule is a week. Prices move, but slowly enough that a stale week
// is a reference and a stale hour would be a needless fetch — and the card that
// uses this is read in the second after an answer, which is the worst possible
// moment to make someone wait for a catalog.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DIR } from '../core/paths.mjs';

export const PRICE_CACHE = join(DIR, 'prices-cache.json');
/** A week: prices move, but not so fast that a stale week is a lie. */
export const PRICE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The cached catalog, or an empty list when it is missing or too old.
 *
 * `{at, models}` on disk. A corrupt file is the same as no file: every caller
 * has a fallback either way, and a crash here would take down a card.
 */
export function loadPrices(now = Date.now(), ttl = PRICE_TTL_MS, file = PRICE_CACHE) {
  try {
    if (!existsSync(file)) return { at: 0, models: [] };
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    const at = Number(parsed?.at) || 0;
    const models = Array.isArray(parsed?.models) ? parsed.models : [];
    if (!models.length) return { at: 0, models: [] };
    if (now - at > ttl) return { at, models: [] };
    return { at, models };
  } catch {
    return { at: 0, models: [] };
  }
}

/**
 * Store a catalog for the turns that follow.
 *
 * Best effort on purpose: a failed write costs the next turn its money line and
 * nothing else, which is not worth an exception in the middle of an answer.
 */
export function savePrices(models, now = Date.now(), file = PRICE_CACHE) {
  try {
    if (!Array.isArray(models) || !models.length) return false;
    // A fresh install has no `tg-bridge` directory yet; a failed save costs one
    // money line, so it creates what it needs instead of throwing.
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ at: now, models }), 'utf8');
    return true;
  } catch {
    return false;
  }
}
