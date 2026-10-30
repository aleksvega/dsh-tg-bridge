// prices.mjs — model prices without a provider-specific plugin.
//
// The one source is OpenRouter's public model list: it is JSON, it carries a
// price for every model it serves, and it is the market rate a person can check
// in one click. A private route or reseller rarely publishes its own numbers, so
// a card built from the route's own page is empty or wrong. Every card therefore
// says whose price it shows: OpenRouter's rate for the same model, as a
// reference — not the invoice.

import { savePrices } from './price-cache.mjs';

const OPENROUTER = 'https://openrouter.ai/api/v1/models';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * OpenRouter's model list -> the shape the card wants.
 *
 * OpenRouter quotes dollars per token as strings ("0.00000015"); the card speaks
 * per million, which is how every other price in the world is written. A model
 * with no `pricing.prompt` is skipped: a missing price is not a free model.
 */
export function parseOpenRouter(json) {
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const perMillion = (raw) => {
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 ? value * 1e6 : null;
  };
  const models = [];
  for (const entry of list) {
    const id = String(entry?.id ?? '').trim();
    const inputPrice = perMillion(entry?.pricing?.prompt);
    if (!id || inputPrice === null) continue;
    const outputPrice = perMillion(entry?.pricing?.completion);
    models.push({
      id,
      inputPrice,
      outputPrice: outputPrice === null ? inputPrice : outputPrice,
      cacheReadPrice: perMillion(entry?.pricing?.input_cache_read),
      context: Number(entry?.context_length) > 0 ? Number(entry.context_length) : null,
    });
  }
  return models;
}

/**
 * The whole catalog, or an empty list with the reason it is empty.
 *
 * Exported because `/cost` needs the same list for the same reason: one source,
 * one set of numbers. Two fetches of two catalogs is how a model ends up with
 * two prices in one bot.
 */
export async function fetchCatalog(timeoutMs = 30000) {
  const res = await fetchText(OPENROUTER, timeoutMs);
  const models = parseOpenRouter(JSON.parse(res));
  // Kept for the callers that must not wait: `/cost` and the final card of a
  // turn read this file instead of fetching. Saving here rather than in each
  // caller means a new caller cannot forget to.
  savePrices(models);
  return models;
}

async function fetchText(url, timeoutMs = 20000) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

/** Human price per 1M tokens. */
function usd(value) {
  if (typeof value !== 'number') return '?';
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;
}

/** The three locales `/prices` speaks; exported so a test can use the real words. */
export const WORDS = {
  en: {
    prices: 'Prices',
    now: 'Current',
    cheap: 'Cheapest with context >= 128k:',
    none: 'No models matched the filter.',
    fail: 'Could not fetch prices',
    notPublic: 'OpenRouter has no price for this model',
    retail: 'Models it does price: {list}',
    yourProvider: 'price published for your provider',
    exact: 'same model on another gateway',
    similar: 'a similar model, not the same id',
    reference: 'reference: OpenRouter price for the same model, not your route',
    perMillion: 'per 1M tokens',
  },
  ru: {
    prices: 'Цены',
    now: 'Сейчас',
    cheap: 'Дешёвые модели с контекстом ≥128k:',
    none: 'Ничего не нашлось по фильтру.',
    fail: 'Не смог получить цены',
    notPublic: 'у OpenRouter этой модели нет',
    retail: 'Есть цена у: {list}',
    yourProvider: 'цена опубликована для вашего провайдера',
    exact: 'та же модель на другом шлюзе',
    similar: 'похожая модель, не тот же id',
    reference: 'ориентир: цена OpenRouter для той же модели, не вашего маршрута',
    perMillion: 'за 1М токенов',
  },
  zh: {
    prices: '价格',
    now: '当前',
    cheap: '上下文 ≥128k 的最便宜模型：',
    none: '没有符合筛选条件的模型。',
    fail: '无法获取价格',
    notPublic: 'OpenRouter 没有这个模型的价格',
    retail: '有价格：{list}',
    yourProvider: '你的服务商公布的价格',
    exact: '同一模型，另一家网关',
    similar: '相似的模型，不是同一个 id',
    reference: '参考：同一模型在 OpenRouter 的价格，不是你的线路',
    perMillion: '每百万 token',
  },
};

/**
 * Find a model by id, and say whether the match is the model or a neighbour.
 *
 * Providers prefix ids differently (`openai/gpt-4o`, `gpt-4o`,
 * `vendor/gpt-4o:free`) and a catalog holds the same model on a hundred
 * gateways, 567 of them at cost 0. Shortest-substring matching therefore picked
 * a free mirror of DeepSeek for `deepseek-v4.1-flash` and printed $0.0000 as if
 * that were the price. The order now follows what the question asks: my own
 * provider's price, then a published price for the exact model, and a substring
 * hit is only a reference — `exact: false` — so the card can say whose price it
 * is showing instead of implying it is yours.
 *
 * @param {Array<{id: string, inputPrice: number, outputPrice: number}>} models
 * @param {string} wanted model id as the profile names it, `vendor/` prefix allowed
 * @param {string} [provider] the provider the install bills through
 */
export function findModel(models, wanted, provider = '') {
  // The wanted id loses its prefix, so `vendor/x` and `x` compare equal. A
  // catalog id loses at most a vendor segment: `openrouter/deepseek/x` is
  // openrouter's x, and the provider check below runs on the id as it stands.
  const needle = String(wanted ?? '').trim().toLowerCase().replace(/^[^/]+\//, '');
  if (!needle || needle === '?') return null;
  const own = String(provider ?? '').trim().toLowerCase();
  const bare = (id) => id.toLowerCase().replace(/^(?:[^/]+\/)?(?:[^/]+\/)?/, '');
  const price = (model) => model.outputPrice * 10 + model.inputPrice;

  const grid = (model) => {
    // A published price is the answer, and among published prices the reader's
    // own provider comes first: that is the number on their bill. Only when
    // nobody publishes one does the reader's own zero beat a stranger's.
    if (model.inputPrice > 0) return claims(model.id, own) ? 0 : 1;
    return claims(model.id, own) ? 2 : 3;
  };

  const ranked = (list) => [...list].sort((a, b) => {
    // A provider's own table is the answer even when it is zero: that is what
    // it charges. A stranger's zero is a missing price, so it loses first.
    const byGrid = grid(a) - grid(b);
    if (byGrid !== 0) return byGrid;
    return price(a) - price(b);
  })[0];
  const hit = ranked(models.filter((model) => bare(model.id) === needle))
    || ranked(models.filter((model) => bare(model.id).includes(needle)));
  return hit ? { ...hit, exact: bare(hit.id) === needle } : null;
}

/**
 * The provider prefix a person would recognise: `mygateway` for the install,
 * `openrouter` for a model the catalog lists under `openrouter/vendor/name`.
 * A gateway that names the vendor in its path still starts with its own name,
 * so a prefix match on the provider is what decides "is this yours".
 */
function claims(modelId, provider) {
  const own = String(provider ?? '').trim().toLowerCase();
  return Boolean(own) && modelId.toLowerCase().startsWith(`${own}/`);
}

/**
 * The two lines that say what the current model costs, and whose price it is.
 * Kept apart from the fetch so the wording can be tested offline: the failure
 * this replaces was a confident "$0.0000", and a wrong price is worse than none.
 *
 * Every number here is OpenRouter's, and the card says so. A private route
 * publishes nothing, so its own number would be either missing or invented; the
 * market rate for the same model is the honest reference, and it is checkable.
 */
export function describeCurrent(models, { model, provider } = {}, words) {
  const name = provider ? `${provider}/${model}` : model;
  const current = findModel(models, model, provider);
  const lower = String(model).toLowerCase();
  const published = models.filter((m) => m.inputPrice > 0 && m.id.toLowerCase().includes(lower));
  const paid = [...published]
    .sort((a, b) => a.inputPrice - b.inputPrice)
    .slice(0, 3)
    .map((m) => `${m.id} ${usd(m.inputPrice)}/${usd(m.outputPrice)}`);
  if (!current) {
    return [
      `${words.now}: ${name} — ${words.notPublic}`,
      ...(paid.length > 0 ? [`  ${words.retail.replace('{list}', paid.join(' · '))}`] : []),
    ];
  }
  const price = current.inputPrice > 0
    ? `${usd(current.inputPrice)} / ${usd(current.outputPrice)} ${words.perMillion}`
    : words.notPublic;
  // Whose price this is, on the same line as the id it came from: a reader must
  // be able to check the number in one click, and must not think it is their
  // own bill. A private route publishes nothing, so it never claims one.
  const where = claims(current.id, provider)
    ? `${current.id} — ${words.yourProvider}`
    : `${current.id} — ${words.reference}`;
  return [`${words.now}: ${name} — ${price}`, `  ${where}`];
}

/**
 * Render `/prices [filter]`.
 *
 * OpenRouter is the only source: one JSON list, a published price for every
 * model it serves, and a page a person can check. A second catalog would only
 * reintroduce the bug this replaces — two numbers for one model, and a guess
 * about which is the reader's.
 *
 * @param {string} filter optional text to match model ids
 * @param {{ model?: string, provider?: string, lang?: string }} options
 */
export async function renderPrices(filter = '', options = {}) {
  const lang = WORDS[options.lang] ? options.lang : 'en';
  const words = WORDS[lang];
  const [openrouter] = await Promise.allSettled([fetchCatalog()]);

  let models = [];
  const sources = [];
  if (openrouter?.status === 'fulfilled' && openrouter.value.length > 0) {
    models.push(...openrouter.value);
    sources.push('OpenRouter');
  }
  if (models.length === 0) {
    const reason = openrouter?.status === 'rejected'
      ? openrouter.reason?.message
      : 'the OpenRouter list parsed to 0 models';
    return `${words.fail}: ${reason}`;
  }

  // One catalog, so duplicate ids cannot disagree about a price.
  const seen = new Set();
  models = models.filter((model) => {
    const id = model.id.toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // The per-model list answers "what do I pay", so a price tag is required: a
  // catalog entry at 0 is a mirror that publishes nothing, not a free model.
  // It may still be what `findModel` found, which is why the two are separate.
  const wanted = String(filter ?? '').trim().toLowerCase();
  let rows = models.filter((m) => ((m.context ?? 0) >= 128000 || m.context === null) && m.inputPrice > 0);
  if (wanted) rows = rows.filter((m) => m.id.toLowerCase().includes(wanted));
  rows.sort((a, b) => a.inputPrice - b.inputPrice);

  const lines = [`${words.prices}: ${sources.join(' + ')}`, ''];
  if (options.model && options.model !== '?') {
    const current = findModel(models, options.model, options.provider);
    const name = options.provider ? `${options.provider}/${options.model}` : options.model;
    lines.push(...describeCurrent(models, options, words), '');
  }
  lines.push(words.cheap);
  for (const model of rows.slice(0, 12)) {
    const context = model.context ? `${Math.round(model.context / 1000)}k` : '?';
    lines.push(`• ${model.id} — ${usd(model.inputPrice)} / ${usd(model.outputPrice)} · ${context}`);
  }
  if (rows.length === 0) lines.push(words.none);
  return lines.join('\n');
}
