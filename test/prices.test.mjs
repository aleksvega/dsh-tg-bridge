// /prices has one source now: OpenRouter's public model list.
//
// The old card mixed models.dev with a scraped provider page and could print
// $0.0000 for the model the install actually runs — a price that is wrong is
// worse than no price, because it gets believed. OpenRouter publishes a number
// for every model it serves and a page a reader can check, so the card shows
// that number and says in words that it is a reference, not the invoice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS, describeCurrent, findModel, parseOpenRouter } from '../model/prices.mjs';

// The shape OpenRouter returns, trimmed to what /prices reads. Prices are
// dollars per token as strings.
const catalog = {
  data: [
    { id: 'deepseek/deepseek-v4.1-flash', context_length: 1048576, pricing: { prompt: '0.00000014', completion: '0.00000042', input_cache_read: '0.000000003' } },
    { id: 'deepseek/deepseek-v4.1-flash-1017', context_length: 1048576, pricing: { prompt: '0.00000015', completion: '0.0000006' } },
    { id: 'z-ai/glm-5.2', context_length: 1049000, pricing: { prompt: '0.0000000096', completion: '0.000007' } },
    // A model with no published price is skipped, not priced at zero.
    { id: 'mystery/no-price', context_length: 128000, pricing: {} },
  ],
};
const models = parseOpenRouter(catalog);
const words = WORDS.en;

test('per-token strings become a price per million', () => {
  const flash = models.find((m) => m.id === 'deepseek/deepseek-v4.1-flash');
  assert.equal(flash.inputPrice, 0.14);
  assert.equal(flash.outputPrice, 0.42);
  assert.equal(flash.context, 1048576);
});

test('a model without a price is not a free model', () => {
  assert.equal(models.find((m) => m.id === 'mystery/no-price'), undefined);
});

test('the exact id wins over a version suffix', () => {
  const hit = findModel(models, 'deepseek-v4.1-flash', 'wikivibe');
  assert.equal(hit.id, 'deepseek/deepseek-v4.1-flash');
  assert.equal(hit.exact, true);
  assert.equal(findModel(models, 'deepseek-v4.1-flash-1017', 'wikivibe').id, 'deepseek/deepseek-v4.1-flash-1017');
});

test('the card says the number is a reference, not the route bill', () => {
  const lines = describeCurrent(models, { model: 'deepseek-v4.1-flash', provider: 'wikivibe' }, words);
  assert.match(lines[0], /\$0\.14 \/ \$0\.42 per 1M tokens/);
  assert.match(lines[1], /reference: OpenRouter price for the same model, not your route/);
  assert.match(lines[1], /deepseek\/deepseek-v4\.1-flash/, 'the source id must be visible to check');
});

test('a model OpenRouter does not carry says so', () => {
  const lines = describeCurrent(models, { model: 'nowhere-model', provider: 'wikivibe' }, words);
  assert.match(lines[0], /OpenRouter has no price/);
  assert.doesNotMatch(lines.join('\n'), /\$0\./);
});

test('the same card speaks Russian and Chinese', () => {
  for (const lang of ['ru', 'zh']) {
    const lines = describeCurrent(models, { model: 'deepseek-v4.1-flash', provider: 'wikivibe' }, WORDS[lang]);
    assert.match(lines[0], /\$0\.14/, lang);
    assert.match(lines[1], /OpenRouter/, lang);
  }
});

test('nothing is invented when nothing matches', () => {
  assert.equal(findModel(models, 'not-a-model-at-all', 'wikivibe'), null);
  assert.equal(findModel(models, '', 'wikivibe'), null);
});
