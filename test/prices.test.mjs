// /prices used to answer $0.0000 / $0.0000 for the model the install actually
// runs. The catalog holds the same model on a hundred gateways, 567 entries at
// cost 0, and the matcher took the shortest substring hit — a free mirror. A
// price that is wrong is worse than "no public price": the second invites a
// check, the first gets believed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS, describeCurrent, findModel, parseModelsDev } from '../prices.mjs';

// The shape models.dev returns, trimmed to what /prices reads.
const catalog = {
  mygateway: { models: { 'deepseek-v4.1-flash': { cost: { input: 0, output: 0 } } } },
  amd: { models: { 'DeepSeek-V4.1-Flash': { cost: { input: 0, output: 0 }, limit: { context: 1048576 } } } },
  engy: { models: { 'deepseek-v4.1-flash': { cost: { input: 0.03, output: 0.12 }, limit: { context: 1048576 } } } },
  openrouter: {
    models: {
      'deepseek/deepseek-v4.1-flash': { cost: { input: 0.02, output: 1 }, limit: { context: 1048576 } },
      'deepseek/deepseek-v4.1-flash-1017': { cost: { input: 0.15, output: 0.6 }, limit: { context: 1048576 } },
    },
  },
};
const models = parseModelsDev(catalog);
const words = WORDS.en;

test('a price-less mirror never wins over a published price', () => {
  // The real failure: the gateway lists the model at 0, so it is that provider's
  // own table, but it says nothing. A gateway with a real price is more useful.
  const hit = findModel(models, 'deepseek-v4.1-flash', 'mygateway');
  assert.equal(hit.id, 'engy/deepseek-v4.1-flash');
  assert.ok(hit.inputPrice > 0);
});

test('the provider the install bills through wins when it publishes a price', () => {
  // Both exact ids name the same model; only one belongs to the reader.
  assert.equal(findModel(models, 'deepseek-v4.1-flash', 'openrouter').id, 'openrouter/deepseek/deepseek-v4.1-flash');
  assert.equal(findModel(models, 'deepseek-v4.1-flash', 'other').id, 'engy/deepseek-v4.1-flash');
});

test("a provider's own zero is not a price to print", () => {
  const lines = describeCurrent(models, { model: 'deepseek-v4.1-flash', provider: 'mygateway' }, words);
  assert.doesNotMatch(lines.join('\n'), /\$0\.0000/);
});

test('a substring hit is reported as a neighbour, not as the model', () => {
  const near = findModel(models, 'v4.1-flash', 'mygateway');
  assert.equal(near.exact, false);
  // A version suffix is a different model, and is matched exactly.
  assert.equal(findModel(models, 'deepseek-v4.1-flash-1017', 'openrouter').exact, true);
});

test('a route with no published price says so instead of printing a number', () => {
  const lines = describeCurrent(models, { model: 'nowhere-model', provider: 'mygateway' }, words);
  assert.match(lines[0], /no public price/);
  assert.doesNotMatch(lines.join('\n'), /\$0\./);
});

test('a price from another gateway is labelled as one', () => {
  const [first, second] = describeCurrent(models, { model: 'deepseek-v4.1-flash', provider: 'mygateway' }, words);
  assert.match(first, /\$0\.03 \/ \$0\.12/);
  assert.match(second, /engy\/deepseek-v4\.1-flash \(same model on another gateway\)/);
});

test('the same card speaks Russian and Chinese', () => {
  for (const lang of ['ru', 'zh']) {
    const lines = describeCurrent(models, { model: 'deepseek-v4.1-flash', provider: 'mygateway' }, WORDS[lang]);
    assert.match(lines[1], /engy/, lang);
    assert.doesNotMatch(lines.join('\n'), /\$0\.00 /, lang);
  }
});

test('nothing is invented when nothing matches', () => {
  assert.equal(findModel(models, 'not-a-model-at-all', 'mygateway'), null);
  assert.equal(findModel(models, '', 'mygateway'), null);
});