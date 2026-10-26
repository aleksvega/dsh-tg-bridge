// prices.mjs — model prices without a provider-specific plugin.
//
// `/prices` reads the public models.dev catalog by default. An install that
// wants live prices from its own provider can point `pricesUrl` at that
// provider's public model page; the parser is generic, so no vendor is baked
// into the code.

const MODELS_DEV = 'https://models.dev/api.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** "1.0M", "262K", "1,048,576" -> tokens. */
export function parseCount(raw) {
  const text = String(raw ?? '').replace(/[,\s]/g, '').trim().toLowerCase();
  const match = /^([0-9]*\.?[0-9]+)([kmbt])?$/.exec(text);
  if (!match) return null;
  const scale = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[match[2]] ?? 1;
  const value = Number(match[1]) * scale;
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** "$0.30" -> 0.3 (USD per 1M tokens). */
export function parsePrice(raw) {
  const match = /\$\s*([0-9]+(?:\.[0-9]+)?)/.exec(String(raw ?? ''));
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parse the server-rendered models table.
 *
 * The page is a table of cards; each row carries a model id and one or more
 * price cells. Rather than depend on the exact DOM, this scans for rows that
 * contain both a model-ish token and a `$` price, which survives markup churn.
 */
export function parseModelsPage(html) {
  const models = [];
  // Tokens that are markup artefacts, not model ids.
  const junk = new Set(['data-slot', 'data-value', 'data-size', 'class', 'style', 'href', 'span', 'div', 'table', 'tbody', 'transition-colors', 'text-sm', 'text-xs', 'flex-col']);
  const cssLike = /(color|colou?rs|text-(?:sm|xs|lg|xl)|flex-|grid-|bg-|border-|rounded-|font-|hover:|px-|py-|mt-|mb-)/i;
  const rows = String(html ?? '').split(/<tr[\s>]/i).slice(1);
  for (const row of rows) {
    const text = row.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const prices = [...text.matchAll(/\$\s*([0-9]+(?:\.[0-9]+)?)/g)].map((m) => Number(m[1]));
    if (prices.length === 0) continue;
    // A model id: a long token with a dash or a slash, never an attribute name.
    const candidates = [...text.matchAll(/\b([a-z][a-z0-9]*(?:[./\-][a-z0-9]+){1,4})\b/gi)]
      .map((m) => m[1])
      .filter((token) => token.length >= 6 && !junk.has(token.toLowerCase()) && !/^data-/i.test(token) && !cssLike.test(token) && /[a-z]/i.test(token) && /\d/.test(token) && /-|\./.test(token));
    const id = candidates.sort((a, b) => b.length - a.length)[0];
    if (!id) continue;
    // Context must be labelled; a bare number is a price or an uptime figure.
    const contextMatch = /(\d+(?:[.,]\d+)?)\s*([KMB])\b\s*(?:tokens|токен|context|контекст|ctx)?/i.exec(text);
    const parsedContext = contextMatch ? parseCount(`${contextMatch[1]}${contextMatch[2]}`) : null;
    // A context window above 4M is a mis-parse of some other number on the row.
    const context = parsedContext && parsedContext <= 4000000 ? parsedContext : null;
    models.push({
      id: id.replace(/^www\./i, ''),
      inputPrice: prices[0],
      outputPrice: prices[1] ?? prices[0],
      context,
    });
  }
  return models;
}

/** models.dev catalog -> the same shape. */
export function parseModelsDev(catalog) {
  const models = [];
  for (const [provider, entry] of Object.entries(catalog ?? {})) {
    for (const [id, model] of Object.entries(entry?.models ?? {})) {
      const cost = model.cost ?? {};
      if (typeof cost.input !== 'number') continue;
      models.push({
        id: `${provider}/${id}`,
        inputPrice: cost.input,
        outputPrice: typeof cost.output === 'number' ? cost.output : cost.input,
        context: model.limit?.context ?? null,
      });
    }
  }
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
    notPublic: 'no public price — this route does not publish one',
    retail: 'Gateways that do publish it: {list}',
    yourProvider: 'price published for your provider',
    exact: 'same model on another gateway',
    similar: 'a similar model, not the same id',
  },
  ru: {
    prices: 'Цены',
    now: 'Сейчас',
    cheap: 'Дешёвые модели с контекстом ≥128k:',
    none: 'Ничего не нашлось по фильтру.',
    fail: 'Не смог получить цены',
    notPublic: 'публичной цены нет — этот маршрут её не публикует',
    retail: 'Публикуют цену: {list}',
    yourProvider: 'цена опубликована для вашего провайдера',
    exact: 'та же модель на другом шлюзе',
    similar: 'похожая модель, не тот же id',
  },
  zh: {
    prices: '价格',
    now: '当前',
    cheap: '上下文 ≥128k 的最便宜模型：',
    none: '没有符合筛选条件的模型。',
    fail: '无法获取价格',
    notPublic: '没有公开价格——这条线路不发布价格',
    retail: '公开发布价格的网关：{list}',
    yourProvider: '你的服务商公布的价格',
    exact: '同一模型，另一家网关',
    similar: '相似的模型，不是同一个 id',
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
    ? `${usd(current.inputPrice)} / ${usd(current.outputPrice)} per 1M`
    : words.notPublic;
  const where = claims(current.id, provider)
    ? words.yourProvider
    : `${current.id} (${current.exact ? words.exact : words.similar})`;
  return [`${words.now}: ${name} — ${price}`, `  ${where}`];
}

/**
 * Render `/prices [filter]` from the public market catalog, plus an optional
 * provider page configured as `pricesUrl`. Neither source is required: if one
 * is down the other still answers, and with no `pricesUrl` only models.dev is
 * queried.
 * @param {string} filter optional text to match model ids
 * @param {{ model?: string, provider?: string, pageUrl?: string, lang?: string }} options
 */
export async function renderPrices(filter = '', options = {}) {
  const lang = WORDS[options.lang] ? options.lang : 'en';
  const words = WORDS[lang];
  const pageUrl = String(options.pageUrl || '').trim();
  const jobs = [fetchText(MODELS_DEV, 30000)];
  if (pageUrl) jobs.unshift(fetchText(pageUrl));
  const results = await Promise.allSettled(jobs);
  const page = pageUrl ? results[0] : null;
  const dev = pageUrl ? results[1] : results[0];

  let models = [];
  const sources = [];
  if (page?.status === 'fulfilled') {
    const parsed = parseModelsPage(page.value);
    if (parsed.length > 0) {
      models.push(...parsed);
      try { sources.push(new URL(pageUrl).hostname.replace(/^www\./i, '')); } catch { sources.push('provider'); }
    }
  }
  if (dev?.status === 'fulfilled') {
    try {
      const parsed = parseModelsDev(JSON.parse(dev.value));
      if (parsed.length > 0) {
        models.push(...parsed);
        sources.push('models.dev');
      }
    } catch {}
  }
  if (models.length === 0) {
    const reason = dev?.status === 'rejected'
      ? dev.reason?.message
      : page?.status === 'rejected'
        ? page.reason?.message
        : 'catalogs parsed to 0 models';
    return `${words.fail}: ${reason}`;
  }

  // The live page wins on duplicate ids; models.dev fills the rest.
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
