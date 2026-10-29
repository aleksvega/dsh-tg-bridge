// The failover card and its command: the chain a person can see and change.
//
// The bug this covers was not a crash. `fallbackModels` sat in config.json with
// no reader, so a failed turn either switched to a route nobody chose or did not
// switch at all, and the chat could not say which. A card is the fix only if it
// counts what the turn would really try and if every button runs a real verb.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FALLBACK_PREFIX, chainLine, chainSummary, describeChain, fallbackKeyboard, isFallbackPress,
  isUsable, pressTarget, removeKeyboard, renderFallbackCard, renderProbe,
} from '../fallback-card.mjs';
import { handleFallbackCommands, overlayName, overlayText, splitRoute } from '../control/cmd-fallback.mjs';
import { t } from '../i18n.mjs';

const tr = (key, vars) => t('en', key, vars);
const trRu = (key, vars) => t('ru', key, vars);

/** A route with a real overlay file, so `isUsable` sees what a live install sees. */
function route(dir, { provider = 'alpha', model = 'm', free = false, off = false } = {}) {
  const patch = join(dir, overlayName({ provider, model }));
  writeFileSync(patch, overlayText({ provider, model }), 'utf8');
  const entry = { provider, model, patch };
  if (free) entry.free = true;
  if (off) entry.off = true;
  return entry;
}

const dir = mkdtempSync(join(tmpdir(), 'fb-card-'));

test('a route counts as usable only when its overlay file is on disk', () => {
  const live = route(dir);
  assert.equal(isUsable(live), true);
  assert.equal(isUsable({ provider: 'a', model: 'b', patch: join(dir, 'missing.yml') }), false);
  assert.equal(isUsable({ provider: 'a', model: 'b' }), false);
  assert.equal(isUsable(null), false);
});

test('the count is what a turn would really try, not how long the list is', () => {
  const chain = [
    route(dir, { model: 'one' }),
    route(dir, { model: 'two', off: true }),
    { provider: 'gone', model: 'three', patch: join(dir, 'nope.yml') },
  ];
  const line = describeChain(chain, { t: tr });
  assert.match(line, /1 of 3/, 'one live route out of three entries');
  assert.match(line, /1 switched off/);
  assert.match(line, /1 without an overlay file/);
  // An empty chain says why it is empty instead of printing "0 of 0".
  assert.equal(describeChain([], { t: tr }), t('en', 'ctrl.fallback.empty'));
});

test('a route line names the route and marks free, off and broken', () => {
  const chain = [
    route(dir, { provider: 'alpha', model: 'm', free: true }),
    route(dir, { provider: 'beta', model: 'n', off: true }),
    { provider: 'gamma', model: 'o', patch: join(dir, 'missing.yml') },
  ];
  assert.equal(chainLine(chain[0], 0, { t: tr }), '1. alpha/m · free');
  assert.equal(chainLine(chain[1], 1, { t: tr }), '2. beta/n · off');
  assert.equal(chainLine(chain[2], 2, { t: tr }), '3. gamma/o · broken');
  // An entry with no name and no overlay is named as such and marked, not hidden.
  assert.equal(chainLine({ model: '' }, 0, { t: tr }), `1. ${t('en', 'ctrl.fallback.unnamed')} · ${t('en', 'ctrl.fallback.broken')}`);
});

test('every button carries a payload Telegram accepts and this bridge can route', () => {
  const chain = [route(dir, { model: 'a' }), route(dir, { model: 'b' })];
  const rows = fallbackKeyboard({ t: tr, chain, enabled: true });
  const buttons = rows.flat();
  assert.ok(buttons.length >= 8, 'two routes, test, switch and remove');
  for (const button of buttons) {
    assert.ok(button.data.length <= 64, `${button.data} is longer than a callback payload`);
    assert.ok(button.data.startsWith(FALLBACK_PREFIX), `${button.data} is not a failover press`);
    const target = pressTarget(button.data);
    assert.ok(target && target.verb, `${button.data} does not parse`);
  }
  // The switch shows the state it would move to, not the one it is in.
  assert.equal(buttons.some((b) => b.text === t('en', 'ctrl.fallback.disable')), true);
  const off = fallbackKeyboard({ t: tr, chain, enabled: false }).flat();
  assert.equal(off.some((b) => b.text === t('en', 'ctrl.fallback.enable')), true);
  // An empty chain has nothing to remove, so no remove button.
  assert.equal(fallbackKeyboard({ t: tr, chain: [], enabled: true }).flat().some((b) => b.data === 'fb:r'), false);
});

test('pressTarget reads what the card wrote and refuses anything else', () => {
  assert.deepEqual(pressTarget('fb:u:3'), { verb: 'u', n: 3 });
  assert.deepEqual(pressTarget('fb:x'), { verb: 'x', n: 0 });
  assert.equal(pressTarget('mn:hub'), null);
  assert.equal(pressTarget('fb:'), null);
  assert.equal(pressTarget(''), null);
  assert.equal(isFallbackPress('fb:e'), true);
  assert.equal(isFallbackPress('mn:hub'), false);
});

test('the card says what starts a switch and what does not', () => {
  const card = renderFallbackCard({
    t: tr,
    chain: [route(dir, { model: 'a' })],
    primary: { provider: 'here', model: 'now' },
    enabled: true,
  });
  assert.match(card.text, /Failover chain/);
  assert.match(card.text, /here\/now/, 'the route this topic answers on is named');
  assert.match(card.text, /400/, 'a refusal is listed as a trigger');
  assert.match(card.text, /Does not switch/, 'the negative list is present');
  assert.match(card.text, /time cap/);
  assert.ok(card.keyboard.length >= 2);
});

test('the card speaks Russian without a raw key', () => {
  const card = renderFallbackCard({ t: trRu, chain: [route(dir, { model: 'a' })], primary: {}, enabled: false });
  assert.doesNotMatch(card.text, /ctrl\./);
  assert.match(card.text, /Цепочка/);
});

test('the probe answer names the route, the verdict and its own limit', () => {
  const text = renderProbe({ t: tr, rows: [{ n: 1, route: 'alpha/m', kind: 'ok' }, { n: 2, route: 'beta/n', kind: 'balance' }] });
  assert.match(text, /1\. alpha\/m — answers/);
  assert.match(text, /2\. beta\/n — no balance/);
  assert.match(text, /does not prove/, 'a probe is not a full turn, and the card says so');
});

test('the probe measures the wait, not just the word "ok"', () => {
  // Two routes can both answer "ok" and feel nothing alike: one says the word in
  // 300 ms, another in nine seconds, and the person is choosing the head of the
  // chain on exactly that difference. A probe that reports only "answers" makes
  // the slow route look as good as the fast one.
  const text = renderProbe({
    t: tr,
    rows: [
      { n: 1, route: 'alpha/fast', kind: 'ok', ms: 412 },
      { n: 2, route: 'beta/slow', kind: 'ok', ms: 9120 },
    ],
  });
  assert.match(text, /412 ms to first token/);
  assert.match(text, /9120 ms to first token/);
  assert.match(text, /Fastest right now: alpha\/fast \(412 ms\)/, 'the fastest route is named once, not left to arithmetic');
  // A route that did not answer has no latency to print: a made-up number would
  // read as "this route works, it is just slow".
  const dead = renderProbe({ t: tr, rows: [{ n: 1, route: 'alpha/m', kind: 'balance', ms: 120 }] });
  assert.doesNotMatch(dead, /to first token/);
  assert.doesNotMatch(dead, /Fastest right now/);
});

test('the remove menu names every route instead of asking for a number', () => {
  const chain = [route(dir, { model: 'a' }), route(dir, { model: 'b' })];
  const rows = removeKeyboard({ t: tr, chain });
  assert.equal(rows[0][0].text, '1. alpha/a');
  assert.equal(rows[1][0].data, 'fb:r:2');
  assert.equal(rows[2][0].data, 'fb:s', 'the last row goes back to the card');
});

test('a route is written as a provider/model overlay, and a free id is marked', () => {
  assert.deepEqual(splitRoute('alpha/m'), { provider: 'alpha', model: 'm' });
  assert.deepEqual(splitRoute('m'), { provider: '', model: 'm' });
  assert.equal(overlayName({ provider: 'alpha', model: 'glm-5.3' }), 'model-alpha-glm-5.3.yml');
  assert.equal(overlayName({ provider: 'alpha', model: 'kimi-k3:free' }), 'model-alpha-kimi-k3_free.yml');
  assert.match(overlayText({ provider: 'alpha', model: 'm' }), /provider: alpha\n\s+model: m/);
});

test('the report line carries the same count the card shows', () => {
  const chain = [route(dir, { model: 'a' }), route(dir, { model: 'b', off: true })];
  const line = chainSummary(chain, { t: tr });
  assert.match(line, /1 of 2/);
  assert.match(line, /1\. alpha\/a/);
  assert.match(line, /2\. alpha\/b \(off\)/);
  assert.equal(chainSummary([], { t: tr }), t('en', 'ctrl.fallback.empty'));
});

/** A context that records what the command says, without touching a real home. */
function ctxFor(config, command = '/fallback', arg = '') {
  const said = [];
  return {
    said,
    ctx: {
      command, arg, effective: command, lang: 'en', config, profile: 'headless',
      reply: (text, extra) => { said.push({ text: String(text), extra }); },
      log: () => {},
      saveConfig: () => true,
    },
  };
}

test('the command claims /fallback and leaves other commands alone', async () => {
  const config = { fallbackModels: [route(dir, { model: 'a' })] };
  const { ctx } = ctxFor(config, '/model', '');
  assert.equal(await handleFallbackCommands(ctx), false, '/model is not this command');
  const { ctx: own, said } = ctxFor(config);
  assert.equal(await handleFallbackCommands(own), true);
  assert.match(said[0].text, /Failover chain/);
  assert.ok(said[0].extra?.keyboard, 'the card arrives with its buttons');
});

test('a word the command does not know answers usage, never a prompt', async () => {
  const { ctx, said } = ctxFor({ fallbackModels: [] }, '/fallback', 'nonsense');
  assert.equal(await handleFallbackCommands(ctx), true);
  assert.match(said[0].text, /\/fallback/);
});

test('off with no number switches the whole chain, and the walk honours it', async () => {
  const config = { fallbackModels: [route(dir, { model: 'a' })], fallbackEnabled: true };
  const { ctx } = ctxFor(config, '/fallback', 'off');
  assert.equal(await handleFallbackCommands(ctx), true);
  assert.equal(config.fallbackEnabled, false, 'the key the turn reads is the one that changed');
  // A second press turns it back on; the card shows the state, not the intent.
  const { ctx: again, said } = ctxFor(config, '/fallback', 'on');
  assert.equal(await handleFallbackCommands(again), true);
  assert.equal(config.fallbackEnabled, true);
  assert.match(said[0].text, /on/i);
});

test('a route can be switched off, moved and removed by number', async () => {
  const config = { fallbackModels: [route(dir, { model: 'a' }), route(dir, { model: 'b' })] };
  await handleFallbackCommands(ctxFor(config, '/fallback', 'skip 2').ctx);
  assert.equal(config.fallbackModels[1].off, true);
  await handleFallbackCommands(ctxFor(config, '/fallback', 'use 2').ctx);
  assert.equal('off' in config.fallbackModels[1], false);
  await handleFallbackCommands(ctxFor(config, '/fallback', 'up 2').ctx);
  assert.equal(config.fallbackModels[0].model, 'b', 'up 2 moved the second route to the first place');
  await handleFallbackCommands(ctxFor(config, '/fallback', 'remove 1').ctx);
  assert.equal(config.fallbackModels.length, 1);
  assert.equal(config.fallbackModels[0].model, 'a');
  // A number that does not exist says so instead of doing something.
  const { ctx, said } = ctxFor(config, '/fallback', 'remove 9');
  assert.equal(await handleFallbackCommands(ctx), true, 'an answer must still claim the command');
  assert.match(said[0].text, /no route/i);
});

test('a route on an unknown provider is refused before a file is written', async () => {
  const config = { fallbackModels: [] };
  const { ctx, said } = ctxFor(config, '/fallback', 'add nosuchvendor/m');
  assert.equal(await handleFallbackCommands(ctx), true);
  assert.match(said[0].text, /nosuchvendor|no provider|provider/i);
  assert.equal(config.fallbackModels.length, 0, 'nothing was added to the chain');
});

test('the command reads the chain fresh on every press', async () => {
  const config = { fallbackModels: [route(dir, { model: 'a' })] };
  const first = ctxFor(config, '/fallback', 'up 1');
  await handleFallbackCommands(first.ctx);
  // Another press arrives after the chain changed: the handler must not reuse a
  // stale copy, or it would move a route nobody chose.
  config.fallbackModels.push(route(dir, { model: 'b' }));
  const second = ctxFor(config, '/fallback', 'up 2');
  await handleFallbackCommands(second.ctx);
  assert.equal(config.fallbackModels[0].model, 'b');
});
