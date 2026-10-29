// What a session cost, and what the card refuses to pretend.
//
// The interesting cases are all the incomplete ones. A bill is input + output +
// cache read at three different rates, and every one of the three can be
// unknown: no usage in the log, no catalog on disk, no price for this model. A
// "$0.00" in any of those is the wrong answer that teaches someone to distrust
// the other numbers, so each one is a test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The cache path is resolved from `DIR` at import time, so the home has to be
// redirected before anything reads it.
const HOME = mkdtempSync(join(tmpdir(), 'dsh-cost-test-'));
process.env.DSH_HOME = HOME;

const { usageCost, usd, priceOf, costReport } = await import('../cost.mjs');
const { loadPrices, savePrices, PRICE_CACHE } = await import('../price-cache.mjs');
const { t } = await import('../i18n.mjs');
const { handleControl } = await import('../control.mjs');

const LANGS = ['en', 'ru', 'zh'];

const STATS = {
  inputTokens: 200_000,
  outputTokens: 40_000,
  cacheReadTokens: 800_000,
  cacheWriteTokens: 0,
  lifetimeTokens: 1_040_000,
  contextTokens: 1_000_000,
  turns: 10,
  outputPerTurn: 4_000,
  model: 'deepseek-v4.1-flash',
  createdAt: 1,
  lastActivity: 2,
};

const CATALOG = [
  { id: 'deepseek/deepseek-v4.1-flash', inputPrice: 0.3, outputPrice: 1.2, cacheReadPrice: 0.03, context: 1_000_000 },
];

test('the three kinds of token are billed at their own rates', () => {
  const cost = usageCost(STATS, { inputPrice: 1, outputPrice: 2, cacheReadPrice: 0.1 });
  // 0.2M * $1 = $0.20 · 0.04M * $2 = $0.08 · 0.8M * $0.1 = $0.08
  assert.equal(cost.input.toFixed(4), '0.2000');
  assert.equal(cost.output.toFixed(4), '0.0800');
  assert.equal(cost.cache.toFixed(4), '0.0800');
  assert.equal(cost.total.toFixed(4), '0.3600');
  assert.equal(cost.partial, false);
});

test('a model with no cache rate bills cache reads as fresh input', () => {
  // Every provider that publishes two numbers does exactly this.
  const cost = usageCost({ cacheReadTokens: 1_000_000 }, { inputPrice: 2, outputPrice: 4 });
  assert.equal(cost.cache, 2);
  assert.equal(cost.partial, false);
});

test('an unknown rate makes the sum a lower bound, not a number', () => {
  // Output has no rate: the total is still computable from the rest, and it must
  // announce itself as partial rather than quietly omit a third of the bill.
  const cost = usageCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, { inputPrice: 1, outputPrice: null, cacheReadPrice: null });
  assert.equal(cost.input, 1);
  assert.equal(cost.output, 0);
  assert.equal(cost.partial, true);
  // Nothing priced at all is not a bill of zero.
  assert.equal(usageCost({ inputTokens: 100 }, { inputPrice: null, outputPrice: null, cacheReadPrice: null }), null);
  assert.equal(usageCost(STATS, null), null);
});

test('a tiny amount keeps enough digits to not read as free', () => {
  assert.equal(usd(0), '$0');
  assert.equal(usd(0.0004), '$0.0004');
  assert.equal(usd(0.0042), '$0.0042');
  assert.equal(usd(0.25), '$0.250');
  assert.equal(usd(12.3456), '$12.35');
  assert.equal(usd(-1), '?');
  assert.equal(usd('x'), '?');
});

test('the catalog is matched to the route, and a missing price is not zero', () => {
  assert.equal(priceOf(CATALOG, 'deepseek-v4.1-flash').inputPrice, 0.3);
  // The route's own provider prefix is preferred when the catalog lists it.
  assert.equal(priceOf(CATALOG, 'deepseek-v4.1-flash', 'openrouter').id, 'deepseek/deepseek-v4.1-flash');
  assert.equal(priceOf(CATALOG, 'no-such-model'), null);
  assert.equal(priceOf([], 'deepseek-v4.1-flash'), null);
  assert.equal(priceOf(CATALOG, '?'), null);
});

test('the card names the bill, the rate and whose prices they are', () => {
  for (const lang of LANGS) {
    const text = costReport({
      stats: STATS,
      route: { provider: 'gateway', model: 'deepseek-v4.1-flash' },
      lang,
      models: CATALOG,
      cacheAt: Date.UTC(2026, 0, 15),
      t,
    });
    assert.ok(text.length > 0, `${lang} produced nothing`);
    assert.doesNotMatch(text, /\{\w+\}/, `${lang} left a placeholder: ${text}`);
    // The three numbers a bill has, and the provenance of the rates.
    assert.match(text, /\$/, `${lang} shows no money`);
    assert.match(text, /deepseek-v4\.1-flash/, `${lang} lost the model`);
    assert.match(text, /2026-01-15/, `${lang} lost the fetch date`);
    // The route is named with its provider: a bare model id hides which gateway
    // is answering, which is the whole point of the line.
    assert.match(text, /gateway\/deepseek-v4\.1-flash/, `${lang} lost the provider`);
  }
});

test('a session with no usage says so instead of showing $0', () => {
  for (const lang of LANGS) {
    const text = costReport({ stats: null, route: { provider: 'g', model: 'm' }, lang, models: CATALOG, t });
    assert.doesNotMatch(text, /\$0\b/, `${lang} claimed a free session: ${text}`);
    assert.doesNotMatch(text, /\{\w+\}/, `${lang} left a placeholder`);
    assert.equal(text, costReport({ stats: { ...STATS, lifetimeTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }, route: { provider: 'g', model: 'm' }, lang, models: CATALOG, t }));
  }
});

test('no catalog and no price are different sentences', () => {
  for (const lang of LANGS) {
    const noCatalog = costReport({ stats: STATS, route: { provider: 'g', model: 'm' }, lang, models: [], t });
    const noPrice = costReport({ stats: STATS, route: { provider: 'g', model: 'm' }, lang, models: CATALOG, t });
    // Both keep the token counts, which are true without any price at all.
    for (const text of [noCatalog, noPrice]) {
      assert.match(text, /200,000|200 000/, `${lang} dropped the input count: ${text}`);
      assert.doesNotMatch(text, /\{\w+\}/, `${lang} left a placeholder`);
    }
    assert.notEqual(noCatalog, noPrice, `${lang} cannot tell the two reasons apart`);
  }
});

test('a partial bill announces itself', () => {
  const text = costReport({
    stats: STATS,
    route: { provider: 'g', model: 'half-priced' },
    lang: 'en',
    models: [{ id: 'half-priced', inputPrice: 1, outputPrice: null, cacheReadPrice: null }],
    t,
  });
  assert.match(text, /lower bound/i);
});

test('the cache survives a round trip, and forgets what is too old', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-price-cache-'));
  const file = join(dir, 'prices-cache.json');
  writeFileSync(file, JSON.stringify({ at: 1000, models: CATALOG }), 'utf8');
  // Fresh: the models come back with the timestamp they were fetched at.
  const fresh = loadPrices(2000, 10_000, file);
  assert.equal(fresh.at, 1000);
  assert.equal(fresh.models.length, 1);
  // Stale: an empty list and the old timestamp, so the caller can say how old.
  const stale = loadPrices(100_000, 10_000, file);
  assert.equal(stale.models.length, 0);
  assert.equal(stale.at, 1000);
  // Missing or corrupt is the same as empty: every caller has a fallback.
  assert.deepEqual(loadPrices(2000, 10_000, join(dir, 'nope.json')), { at: 0, models: [] });
  writeFileSync(file, 'not json', 'utf8');
  assert.deepEqual(loadPrices(2000, 10_000, file), { at: 0, models: [] });
  rmSync(dir, { recursive: true, force: true });
});

test('saving refuses an empty catalog, so a failed fetch cannot erase a good one', () => {
  assert.equal(savePrices([], 1), false);
  assert.equal(savePrices(null, 1), false);
  const saved = savePrices(CATALOG, 5000);
  assert.equal(saved, true);
  const back = loadPrices(5001);
  assert.equal(back.at, 5000);
  assert.equal(back.models[0].id, 'deepseek/deepseek-v4.1-flash');
  // And the real cache path is the one under the redirected home.
  assert.ok(PRICE_CACHE.startsWith(HOME), `${PRICE_CACHE} escaped the test home`);
});

test('/cost answers in every language, and never fetches', async () => {
  // No catalog on disk and no network stubbed: the card must still answer, with
  // the "no catalog" sentence. A command that hangs on a fetch is the failure
  // this catches — the timeout below would fire.
  for (const lang of LANGS) {
    const out = [];
    const ctx = {
      command: '/cost',
      arg: '',
      chatId: 1,
      threadId: 2,
      key: '1:2',
      state: { sessions: {}, profiles: {} },
      config: { profile: 'test' },
      profile: 'test',
      lang,
      activeTurns: new Map(),
      saveState: () => {},
      log: () => {},
      send: async () => {},
      reply: (text) => { out.push(String(text)); return 1; },
      sendFile: async () => {},
      stopTurn: () => false,
      seedTopic: async () => {},
      jobs: () => ({ active: [], queued: 0, max: 3 }),
    };
    const claimed = await handleControl(ctx);
    const text = out.join('\n');
    assert.equal(claimed, true, `${lang} /cost was not handled`);
    assert.ok(text.trim().length > 0, `${lang} /cost said nothing`);
    assert.doesNotMatch(text, /\{\w+\}/, `${lang} /cost left a placeholder: ${text}`);
  }
});
