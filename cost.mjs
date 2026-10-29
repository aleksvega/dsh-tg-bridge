// What a turn cost, in money, without asking the network during the turn.
//
// The rule `prices.mjs` already follows applies here twice over: the only price
// this project can honestly show is the published market rate for the same
// model, and it must say whose rate it is. A private route rarely publishes
// numbers, so a card built from the route's own page is empty or wrong.
//
// The second rule is about time. A turn's final card is drawn once, right after
// the answer, and a network call there would make the answer wait on a catalog.
// Prices are therefore cached on disk and refreshed by `/cost` and `/prices`,
// which a person runs on purpose and can afford to wait for. A card with no
// cache says tokens and no money: silence beats an invented invoice.
import { fetchCatalog, findModel } from './prices.mjs';
import { loadPrices, savePrices } from './price-cache.mjs';

export { loadPrices, savePrices };

/**
 * Money for one usage record.
 *
 * The three kinds of token are billed at three different rates, and cache reads
 * are usually an order of magnitude cheaper than fresh input — which is why
 * lumping them into one "tokens" number overstates the bill on a long session
 * that re-reads its own history. A rate of `null` is not zero: an unknown price
 * makes the answer unknown, not free.
 *
 * @param {{inputTokens?: number, outputTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number}} usage
 * @param {{inputPrice?: number|null, outputPrice?: number|null, cacheReadPrice?: number|null}} price per 1M tokens
 * @returns {{input: number, output: number, cache: number, total: number, partial: boolean} | null}
 */
export function usageCost(usage, price) {
  if (!usage || !price) return null;
  // `Number(null)` is 0, and a null rate is "unknown", not "free" — the one
  // coercion that would turn a missing price into a zero-dollar bill.
  const perMillion = (tokens, rate) => {
    const n = Number(tokens) || 0;
    if (n <= 0) return 0;
    if (rate === null || rate === undefined || rate === '') return null;
    const r = Number(rate);
    return Number.isFinite(r) && r >= 0 ? (n / 1e6) * r : null;
  };
  const input = perMillion(usage.inputTokens, price.inputPrice);
  const output = perMillion(usage.outputTokens, price.outputPrice);
  // A model with no cache rate bills cache reads as fresh input, which is what
  // every provider does when it publishes only two numbers.
  const cache = perMillion(usage.cacheReadTokens, price.cacheReadPrice ?? price.inputPrice);
  // A kind with no tokens is not unknown, it is nothing: only a kind that was
  // actually billed and could not be priced makes the total a lower bound. If
  // that is every kind, there is no bill to report at all.
  const billed = [
    { tokens: usage.inputTokens, cost: input },
    { tokens: usage.outputTokens, cost: output },
    { tokens: usage.cacheReadTokens, cost: cache },
  ].filter((part) => (Number(part.tokens) || 0) > 0);
  if (!billed.length || billed.every((part) => part.cost === null)) return null;
  const partial = billed.some((part) => part.cost === null);
  return {
    input: input ?? 0,
    output: output ?? 0,
    cache: cache ?? 0,
    total: (input ?? 0) + (output ?? 0) + (cache ?? 0),
    partial,
  };
}

/**
 * A dollar amount a person can read.
 *
 * Small numbers keep their precision: a $0.0004 turn rounded to "$0.00" reads as
 * free, and "free" is the one wrong answer here. Above a cent, cents are enough.
 */
export function usd(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '?';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

/**
 * Refresh the cache from the catalog. Called by `/cost` and `/prices`, never by
 * a turn: a network call in the final card would make the answer wait on a
 * catalog, and the answer is the point.
 *
 * Returns the models it stored, or an empty list when the network said no —
 * a failed refresh leaves the old cache in place, because last week's price is
 * a better answer than none.
 */
export async function refreshPrices() {
  return fetchCatalog();
}

/**
 * The price of one model, from the cache, or null.
 *
 * `findModel` already knows how to match a route's id against the catalog and
 * prefers the reader's own provider when it publishes a number. The result is
 * narrowed to the three rates a bill needs; the catalog entry carries more.
 */
export function priceOf(models, model, provider = '') {
  if (!Array.isArray(models) || !models.length) return null;
  const hit = findModel(models, model, provider);
  if (!hit || !(hit.inputPrice > 0)) return null;
  return {
    id: hit.id,
    inputPrice: hit.inputPrice,
    outputPrice: hit.outputPrice,
    cacheReadPrice: hit.cacheReadPrice,
  };
}

/**
 * The `/cost` card: what this session has spent, and what it is spending at.
 *
 * Two numbers and a rate. The total is the bill so far; the rate is what makes
 * the next decision possible ("этот профиль вчетверо дороже"); the source line
 * says whose prices these are, because a price without provenance is a guess
 * with a dollar sign.
 *
 * Every unknown is named rather than zeroed. A session with no usage says so; a
 * model the catalog does not price says so; a cache that was never filled says
 * so, and offers the refresh that fills it.
 *
 * @param {object} input
 * @param {{inputTokens:number, outputTokens:number, cacheReadTokens:number, cacheWriteTokens:number, lifetimeTokens:number, turns:number, model:string}} input.stats
 * @param {{provider: string, model: string}} input.route
 * @param {string} input.lang
 * @param {Array} [input.models] catalog; when empty the money lines are skipped
 * @param {number} [input.cacheAt] when the catalog was fetched
 * @param {(key: string, vars?: object) => string} input.t
 */
export function costReport({ stats, route, lang, models = [], cacheAt = 0, t }) {
  const tr = (key, vars) => t(lang, key, vars);
  const lines = [tr('ctrl.cost.head')];
  const routeName = route?.model ? `${route.provider ? `${route.provider}/` : ''}${route.model}` : '?';
  lines.push(tr('ctrl.cost.model', { route: routeName }));

  if (!stats || !(stats.lifetimeTokens > 0)) {
    // No usage at all is a real answer: a fresh session, or a profile whose
    // provider does not report usage. Both are worth saying out loud.
    lines.push(tr('ctrl.cost.none'));
    return lines.join('\n');
  }

  const price = priceOf(models, route?.model, route?.provider);
  const cost = usageCost(stats, price);
  lines.push('');
  lines.push(tr('ctrl.cost.tokens', {
    input: stats.inputTokens.toLocaleString('en-US'),
    output: stats.outputTokens.toLocaleString('en-US'),
    cache: stats.cacheReadTokens.toLocaleString('en-US'),
  }));
  lines.push(tr('ctrl.cost.turns', { n: stats.turns, avg: stats.outputPerTurn.toLocaleString('en-US') }));

  if (!price) {
    // Two different reasons, one sentence each: no catalog, or no entry in it.
    lines.push(models.length ? tr('ctrl.cost.noPrice', { route: routeName }) : tr('ctrl.cost.noCatalog'));
    return lines.join('\n');
  }

  lines.push('');
  lines.push(tr('ctrl.cost.total', { sum: usd(cost.total) }));
  lines.push(tr('ctrl.cost.split', {
    input: usd(cost.input),
    output: usd(cost.output),
    cache: usd(cost.cache),
  }));
  if (stats.turns > 0) lines.push(tr('ctrl.cost.perTurn', { sum: usd(cost.total / stats.turns) }));
  lines.push('');
  lines.push(tr('ctrl.cost.source', {
    id: price.id,
    input: usd(price.inputPrice),
    output: usd(price.outputPrice),
    when: cacheAt ? new Date(cacheAt).toISOString().slice(0, 10) : '?',
  }));
  if (cost.partial) lines.push(tr('ctrl.cost.partial'));
  return lines.join('\n');
}
