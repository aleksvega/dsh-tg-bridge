// prices.mjs — unorouter model prices without the metrics plugin.
//
// The plugin `dsh-unorouter-metrics` never mounted, so `/prices` had nothing to
// read. This module fetches the public models page directly, parses the table
// and renders a short answer: what the current route costs, and the cheapest
// models that still fit the context floor. Fallback is models.dev, which has
// no uptime data but is stable JSON.

const MODELS_PAGE = 'https://unorouter.com/en/models';
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

const WORDS = {
  en: {
    prices: 'Prices',
    now: 'Current',
    cheap: 'Cheapest with context >= 128k:',
    none: 'No models matched the filter.',
    fail: 'Could not fetch prices',
    unknown: 'not found in the catalog',
  },
  ru: {
    prices: 'Цены',
    now: 'Сейчас',
    cheap: 'Дешёвые модели с контекстом ≥128k:',
    none: 'Ничего не нашлось по фильтру.',
    fail: 'Не смог получить цены',
    unknown: 'в каталоге не найден',
  },
  zh: {
    prices: '价格',
    now: '当前',
    cheap: '上下文 ≥128k 的最便宜模型：',
    none: '没有符合筛选条件的模型。',
    fail: '无法获取价格',
    unknown: '目录中未找到',
  },
};

/**
 * Find a model by id. Providers prefix ids differently (`openai/gpt-4o`,
 * `gpt-4o`, `unorouter/gpt-4o:free`), so exact match first, then the shortest
 * id that contains the wanted token.
 */
export function findModel(models, wanted) {
  const needle = String(wanted ?? '').trim().toLowerCase();
  if (!needle) return null;
  const exact = models.find((model) => model.id.toLowerCase() === needle);
  if (exact) return exact;
  const matches = models.filter((model) => model.id.toLowerCase().includes(needle));
  matches.sort((a, b) => a.id.length - b.id.length);
  return matches[0] || null;
}

/**
 * Render `/prices [filter]` from every catalog we can reach, so the answer does
 * not depend on one provider: the unorouter page carries live prices for its
 * own routes, models.dev covers the rest of the market. Both are merged; the
 * current model is looked up in the merged list.
 * @param {string} filter optional text to match model ids
 * @param {{ model?: string, provider?: string, lang?: string }} options
 */
export async function renderPrices(filter = '', options = {}) {
  const lang = WORDS[options.lang] ? options.lang : 'en';
  const words = WORDS[lang];
  const [page, dev] = await Promise.allSettled([
    fetchText(MODELS_PAGE),
    fetchText(MODELS_DEV, 30000),
  ]);

  let models = [];
  const sources = [];
  if (page.status === 'fulfilled') {
    const parsed = parseModelsPage(page.value);
    if (parsed.length > 0) {
      models.push(...parsed);
      sources.push('unorouter');
    }
  }
  if (dev.status === 'fulfilled') {
    try {
      const parsed = parseModelsDev(JSON.parse(dev.value));
      if (parsed.length > 0) {
        models.push(...parsed);
        sources.push('models.dev');
      }
    } catch {}
  }
  if (models.length === 0) {
    const reason = dev.status === 'rejected'
      ? dev.reason?.message
      : page.status === 'rejected'
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

  const wanted = String(filter ?? '').trim().toLowerCase();
  let rows = models.filter((m) => ((m.context ?? 0) >= 128000 || m.context === null) && m.inputPrice > 0);
  if (wanted) rows = rows.filter((m) => m.id.toLowerCase().includes(wanted));
  rows.sort((a, b) => a.inputPrice - b.inputPrice);

  const lines = [`${words.prices}: ${sources.join(' + ')}`, ''];
  if (options.model && options.model !== '?') {
    const current = findModel(models, options.model);
    const name = options.provider ? `${options.provider}/${options.model}` : options.model;
    lines.push(
      current
        ? `${words.now}: ${name} — ${usd(current.inputPrice)} / ${usd(current.outputPrice)} per 1M`
        : `${words.now}: ${name} (${words.unknown})`,
      ''
    );
  }
  lines.push(words.cheap);
  for (const model of rows.slice(0, 12)) {
    const context = model.context ? `${Math.round(model.context / 1000)}k` : '?';
    lines.push(`• ${model.id} — ${usd(model.inputPrice)} / ${usd(model.outputPrice)} · ${context}`);
  }
  if (rows.length === 0) lines.push(words.none);
  return lines.join('\n');
}
