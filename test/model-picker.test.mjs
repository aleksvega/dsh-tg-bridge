// One route, one button.
//
// The list this replaces was the model ids alone, and the ids repeat: a name
// like `deepseek-v4.1-flash` can be served by several providers, so the same
// word appeared twice and neither row said where the answers would come from.
// `/model deepseek-v4.1-flash` then kept whichever provider the patch already
// had, which is the trap this card exists to close: the person asked for "the
// unorouter one" and got "the same name on the host you were already on".
//
// The tests below are about that confusion, not about pixels: a route is a
// provider AND a model, a press names both, and a press that names a route the
// profile no longer has is refused rather than written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-model-'));
process.env.DSH_HOME = HOME;

// A profile with the two shapes that matter: one model served by two providers,
// a free fallback, and a provider whose `models:` list sits at a different
// depth from the one above it.
const PROFILE = 'headless';
const PATCH = `- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      unorouter:
        displayName: Unorouter
        baseURL: https://api.unorouter.com/v1
        models:
          - id: deepseek-v4.1-flash
            name: deepseek-v4.1-flash
            contextWindow: 1048576
          - id: glm-5.3:free
            name: glm-5.3:free
      wikivibe:
        displayName: Wikivibe
        baseURL: https://api.wikivibe.example/v1
        models:
          - id: deepseek-v4.1-flash
            name: deepseek-v4.1-flash
          - id: kimi-k3
            name: kimi-k3
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: wikivibe
    model: deepseek-v4.1-flash
    reasoningEffort: max
`;

mkdirSync(join(HOME, 'profiles', PROFILE), { recursive: true });
writeFileSync(join(HOME, 'profiles', PROFILE, 'cordis.patch.yml'), PATCH, 'utf8');

const { routesOf, modelOf } = await import('../control/models.mjs');
const { modelCard, modelPress, routeData, handleModelPress, modelPressRouter, MODEL_PREFIX } = await import('../control/model-card.mjs');
const { t } = await import('../core/i18n.mjs');
const { inlineKeyboard } = await import('../chat/telegram.mjs');
const tr = (lang) => (k, v) => t(lang, k, v);

test('a route carries its provider, and the same model under two providers is two routes', () => {
  const routes = routesOf(PROFILE);
  assert.equal(routes.length, 4, 'every model of every provider is one route');
  const flash = routes.filter((route) => route.model === 'deepseek-v4.1-flash');
  assert.deepEqual(flash.map((route) => route.provider), ['unorouter', 'wikivibe']);
  // Exactly one of them is what the patch runs, and it is the same-name one on
  // wikivibe — the trap: the id alone could not tell these two apart.
  assert.equal(flash.filter((route) => route.current).length, 1);
  assert.equal(flash.find((route) => route.current).provider, 'wikivibe');
});

test('the profile header is what marks the current route', () => {
  assert.deepEqual(modelOf(PROFILE), { provider: 'wikivibe', model: 'deepseek-v4.1-flash' });
  const current = routesOf(PROFILE).find((route) => route.current);
  assert.equal(`${current.provider}/${current.model}`, 'wikivibe/deepseek-v4.1-flash');
});

test('a press names the provider and the model, never an index', () => {
  assert.deepEqual(modelPress('md:unorouter:deepseek-v4.1-flash'), {
    kind: 'route',
    scope: 'topic',
    provider: 'unorouter',
    model: 'deepseek-v4.1-flash',
  });
  // A model id may carry a colon of its own; the first colon is the split, so
  // `glm-5.3:free` stays one model rather than becoming two fields.
  assert.deepEqual(modelPress('md:unorouter:glm-5.3:free'), {
    kind: 'route',
    scope: 'topic',
    provider: 'unorouter',
    model: 'glm-5.3:free',
  });
  assert.deepEqual(modelPress('md:list'), { kind: 'list' });
});

test('junk is not a route', () => {
  for (const bad of ['', 'md:', 'md:only', 'md::model', 'md:prov:', 'm:c:status', 'md:a b:c', null]) {
    assert.equal(modelPress(bad), null, `${JSON.stringify(bad)} was taken for a route`);
  }
});

test('every routable model round-trips through its own button data', () => {
  for (const route of routesOf(PROFILE)) {
    const data = routeData(route.provider, route.model);
    assert.ok(data, `${route.provider}/${route.model} has no button data`);
    const back = modelPress(data);
    assert.equal(back.provider, route.provider);
    assert.equal(back.model, route.model);
    assert.ok(Buffer.byteLength(data, 'utf8') <= 64, `${data} is over Telegram's 64 bytes`);
  }
});

test('a route too long for 64 bytes gets no button rather than a wrong one', () => {
  assert.equal(routeData('unorouter', 'x'.repeat(80)), '');
  const card = modelCard({
    profile: PROFILE,
    routes: [
      { provider: 'unorouter', model: 'deepseek-v4.1-flash', current: true },
      { provider: 'unorouter', model: 'x'.repeat(80), current: false },
    ],
    t: tr('en'),
  });
  const data = card.keyboard.flat().map((button) => button.data).filter(Boolean);
  assert.equal(data.length, 3, 'one route, the refresh button, and the scope toggle');
  assert.ok(!data.some((value) => value.includes('xxxx')));
});

test('the card marks the current route and puts every other one behind a button', () => {
  const routes = routesOf(PROFILE);
  const card = modelCard({ profile: PROFILE, routes, t: tr('en') });
  const pressable = card.keyboard.flat().filter(
    (button) => button.data && !['md:list', 'md:@all', 'md:@topic'].includes(button.data),
  );
  assert.equal(pressable.length, routes.length, 'one button per route');
  const current = pressable.find((button) => button.data === 'md:wikivibe:deepseek-v4.1-flash');
  assert.equal(current.text, '✓ wikivibe · deepseek-v4.1-flash', 'the current route says so on the button');
});

test('two endpoints serving one model cannot produce two identical buttons', () => {
  // The fixture has unorouter and wikivibe both serving `deepseek-v4.1-flash`.
  // A button labelled with the model alone gave two buttons the same text and
  // different actions — the person cannot tell them apart, which is the whole
  // reason they opened the route picker.
  const card = modelCard({ profile: PROFILE, routes: routesOf(PROFILE), t: tr('en') });
  const pressable = card.keyboard.flat().filter(
    (button) => button.data && !['md:list', 'md:@all', 'md:@topic'].includes(button.data),
  );
  for (const button of pressable) {
    assert.ok(button.text.includes(' · '), `"${button.text}" does not name a provider`);
  }
  const labels = pressable.map((button) => button.text.replace(/^✓ /, ''));
  assert.equal(new Set(labels).size, labels.length, `two routes share a label: ${labels.join(' | ')}`);
  const shared = pressable.filter((button) => button.text.includes('deepseek-v4.1-flash'));
  assert.ok(shared.length > 1, 'the fixture must keep two providers serving one model');
});

test('every button the card draws survives the keyboard', () => {
  // `inlineKeyboard` deletes a button with no payload, and it must: Telegram
  // rejects the whole message otherwise. The card used to name providers on
  // exactly such a row, so each heading vanished and the card arrived as a bare
  // list of models — a route picker with the routes missing.
  const card = modelCard({ profile: PROFILE, routes: routesOf(PROFILE), t: tr('en') });
  const drawn = card.keyboard.flat();
  const kept = inlineKeyboard(card.keyboard).flat();
  assert.equal(drawn.length, kept.length, 'the card drew a button Telegram would drop');
});

test('the card names both halves of the current route, so "which endpoint" has an answer', () => {
  const card = modelCard({ profile: PROFILE, routes: routesOf(PROFILE), t: tr('en') });
  assert.match(card.text, /wikivibe\/deepseek-v4\.1-flash/);
});

test('three languages, no raw keys', () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const card = modelCard({ profile: PROFILE, routes: routesOf(PROFILE), t: tr(lang) });
    assert.doesNotMatch(card.text, /ctrl\.model\./, `${lang} card leaked a key`);
    const labels = card.keyboard.flat().map((button) => button.text).join('\n');
    assert.doesNotMatch(labels, /ctrl\.model\./, `${lang} buttons leaked a key`);
  }
});

test('a press switches this topic, and the profile is left alone', async () => {
  const said = [];
  const redrawn = [];
  const live = { route: {} };
  const before = readFileSync(join(HOME, 'profiles', PROFILE, 'cordis.patch.yml'), 'utf8');
  const claimed = await handleModelPress({
    data: 'md:unorouter:deepseek-v4.1-flash',
    profile: PROFILE,
    key: '1:7',
    state: live,
    save: () => {},
    lang: 'en',
    t,
    say: async (text) => said.push(text),
    answer: async () => {},
    redraw: async (card) => redrawn.push(card),
  });
  assert.equal(claimed, true);
  assert.deepEqual(live.route['1:7'], { provider: 'unorouter', model: 'deepseek-v4.1-flash' });
  // The whole point of the per-topic switch: the file every other topic boots is
  // byte-for-byte what it was before the press.
  assert.equal(readFileSync(join(HOME, 'profiles', PROFILE, 'cordis.patch.yml'), 'utf8'), before);
  assert.deepEqual(modelOf(PROFILE), { provider: 'wikivibe', model: 'deepseek-v4.1-flash' });
  // The answer names both scopes, because "route → x" alone reads as a change
  // to the whole install.
  assert.match(said[0], /unorouter\/deepseek-v4\.1-flash/);
  assert.match(said[0], /wikivibe\/deepseek-v4\.1-flash/, 'the profile default is named too');
  assert.equal(redrawn.length, 1, 'the card is redrawn so the tick moves');
  const tick = redrawn[0].keyboard.flat().find((button) => button.text.startsWith('✓'));
  assert.equal(tick.data, 'md:unorouter:deepseek-v4.1-flash');
  // And the tick is the topic's, not the profile's: one button is marked.
  assert.equal(redrawn[0].keyboard.flat().filter((button) => button.text.startsWith('✓')).length, 1);
});

test('a press for a route the profile no longer has is refused, not written', async () => {
  const before = readFileSync(join(HOME, 'profiles', PROFILE, 'cordis.patch.yml'), 'utf8');
  const said = [];
  const redrawn = [];
  const live = { route: {} };
  const claimed = await handleModelPress({
    data: 'md:taynik:opus-5-5',
    profile: PROFILE,
    key: '1:7',
    state: live,
    save: () => {},
    lang: 'en',
    t,
    say: async (text) => said.push(text),
    answer: async () => {},
    redraw: async (card) => redrawn.push(card),
  });
  assert.equal(claimed, true, 'a known prefix is still this card’s press');
  assert.equal(readFileSync(join(HOME, 'profiles', PROFILE, 'cordis.patch.yml'), 'utf8'), before);
  assert.deepEqual(live.route, {}, 'a refused route is not stored either');
  assert.match(said[0], /taynik\/opus-5-5/);
  assert.match(said[0], /\/model/, 'the refusal points at the way to see what is real');
  assert.equal(redrawn.length, 1, 'and the card is redrawn from the truth');
});

test('a refresh redraws without touching the route', async () => {
  const before = modelOf(PROFILE);
  const redrawn = [];
  await handleModelPress({
    data: `${MODEL_PREFIX}list`,
    profile: PROFILE,
    lang: 'ru',
    t,
    say: async () => {},
    answer: async () => {},
    redraw: async (card) => redrawn.push(card),
  });
  assert.deepEqual(modelOf(PROFILE), before);
  assert.equal(redrawn.length, 1);
});

test('a message that is not this card’s is not claimed', async () => {
  for (const data of ['m:c:status', 'df:x:1234abcd', 'md:', 'md:only']) {
    const claimed = await handleModelPress({
      data,
      profile: PROFILE,
      lang: 'en',
      t,
      say: async () => {},
      answer: async () => {},
      redraw: async () => {},
    });
    assert.equal(claimed, false, `${data} was claimed`);
  }
});

test('the router a real tap goes through can translate, redraw and claim', async () => {
  // The regression this file was missing. Every test above calls
  // `handleModelPress` directly and passes its own `t`, so a `modelPressRouter`
  // that hands the handler an UNBOUND `t` passed all of them while every real
  // tap died with "ReferenceError: t is not defined" — `/model` → any button,
  // for as long as the picker has existed. The router is the only caller that
  // has to supply `t` itself, so the router is the only caller that can be
  // tested for it.
  //
  // The transport is stubbed rather than mocked away: this asserts the real
  // path (translate, redraw, claim) and only replaces the two network calls.
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) });
    return { json: async () => ({ ok: true, result: { message_id: 5 } }) };
  };
  try {
    const logs = [];
    const answers = [];
    const router = modelPressRouter({
      chatId: 1,
      threadId: 7,
      messageId: 42,
      key: `1:7`,
      lang: 'ru',
      answer: async (text) => answers.push(text),
      log: (line) => logs.push(line),
    });

    // `md:@all` is the owner's own press: it is the button whose data carries no
    // route, so it exercises the translation and the branch together.
    assert.equal(await router('md:@all'), true, 'the scope press must be claimed');
    const edit = calls.find((call) => call.method === 'editMessageText');
    assert.ok(edit, 'the card is redrawn in place');
    assert.ok(edit.body.text && !/ctrl\.model\./.test(edit.body.text), `the redraw leaked an i18n key: ${edit.body.text}`);
    assert.ok(edit.body.reply_markup.inline_keyboard.length > 0, 'and it keeps its buttons');
    assert.ok(answers.length > 0, 'the tap is acknowledged, so the spinner stops');
    assert.equal(logs.length, 1, `a claimed press is logged once: ${JSON.stringify(logs)}`);
    assert.match(logs[0], /md:@all/);

    // A button that is not this card's is still not claimed, and says nothing.
    assert.equal(await router('df:x:1234abcd'), false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a profile with no models says so instead of showing an empty keyboard', () => {
  const dir = join(HOME, 'profiles', 'bare');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cordis.patch.yml'), '- id: llm-pi-ai\n  config:\n    providers:\n', 'utf8');
  const card = modelCard({ profile: 'bare', routes: routesOf('bare'), t: tr('en') });
  assert.match(card.text, /no models to choose from/);
  // The refresh button is still there: an empty card with no way to ask again
  // is a dead end, and a profile can gain a model while the card is open.
  assert.equal(card.keyboard.length, 1);
  assert.equal(card.keyboard[0][0].data, `${MODEL_PREFIX}list`);
});

test('the card can change every topic at once, not only the one it was opened in', () => {
  // The owner could not find how to move his endpoints from the panel: the
  // global scope existed as `/model <route> global` and nowhere on the card, so
  // the panel offered a switch that moved one topic while the profile — the
  // thing every other topic follows — stayed where it was.
  assert.deepEqual(modelPress('md:@all'), { kind: 'scope', scope: 'all' });
  assert.deepEqual(modelPress('md:@topic'), { kind: 'scope', scope: 'topic' });
  // A global route press carries the scope, and the `@` cannot be a provider id,
  // so a provider legitimately named `all` is still reachable.
  assert.deepEqual(modelPress('md:@unorouter:deepseek-v4.1-flash'), {
    kind: 'route',
    scope: 'all',
    provider: 'unorouter',
    model: 'deepseek-v4.1-flash',
  });
  assert.equal(modelPress('md:@'), null);
  assert.equal(modelPress('md:@:model'), null);
  assert.equal(modelPress('md:@prov:'), null);
  assert.deepEqual(modelPress('md:unorouter:deepseek-v4.1-flash').scope, 'topic',
    'a plain route press stays this topic\u2019s');
});

test('a global route button is drawn for the global scope, and says so', () => {
  const routes = routesOf(PROFILE);
  const topicCard = modelCard({ profile: PROFILE, routes, t: tr('en') });
  const allCard = modelCard({ profile: PROFILE, routes, t: tr('en'), scope: 'all' });
  // The route buttons carry different data in the two modes, which is what makes
  // the same tap mean "this topic" or "everywhere".
  const routeData = (card, prefix) => card.keyboard.flat()
    .map((b) => b.data)
    .filter((d) => d?.startsWith(prefix) && d !== `${MODEL_PREFIX}list`);
  const topicButtons = routeData(topicCard, 'md:').filter((d) => !d.startsWith('md:@'));
  const allButtons = routeData(allCard, 'md:@').filter((d) => d !== 'md:@topic');
  assert.ok(topicButtons.length > 0 && allButtons.length > 0);
  assert.equal(allButtons.length, topicButtons.length, 'every route is pressable in both modes');
  // Both modes say which one is on, and offer the other.
  assert.match(topicCard.keyboard.flat().map((b) => b.text).join('\n'), /everywhere/i);
  assert.match(allCard.keyboard.flat().map((b) => b.text).join('\n'), /this topic/i);
  // The toggle names the mode that is ON and where the tap goes: in the topic
  // mode it reads "this topic", and pressing it offers "everywhere".
  assert.equal(topicCard.keyboard.flat().find((b) => b.data === 'md:@all').text.includes('💬'), true);
  assert.equal(allCard.keyboard.flat().find((b) => b.data === 'md:@topic').text.includes('🌍'), true);
  // The header agreement: in the global mode it must not claim to describe this
  // topic, because that is the line a person checks before tapping.
  assert.match(allCard.text, /everywhere/i);
  const zh = modelCard({ profile: PROFILE, routes, t: tr('zh'), scope: 'all' });
  assert.doesNotMatch(zh.text, /ctrl\.model\./, 'the global header leaked a key');
});

test('a global press writes the profile default and leaves the topic alone', async () => {
  const said = [];
  const redrawn = [];
  const live = { route: {} };
  const patchFile = join(HOME, 'profiles', PROFILE, 'cordis.patch.yml');
  // Byte-for-byte, because this test is the only one that edits the shared
  // fixture profile on purpose: a text replace would leave the file subtly
  // different for every test after it.
  const before = readFileSync(patchFile, 'utf8');
  const claimed = await handleModelPress({
    data: 'md:@unorouter:glm-5.3:free',
    profile: PROFILE,
    key: '1:7',
    state: live,
    save: () => {},
    lang: 'en',
    t,
    say: async (text) => said.push(text),
    answer: async () => {},
    redraw: async (card) => redrawn.push(card),
  });
  assert.equal(claimed, true);
  // The whole install moved...
  assert.deepEqual(modelOf(PROFILE), { provider: 'unorouter', model: 'glm-5.3:free' });
  // ...and this topic was NOT given a route of its own, so it follows the new
  // default like every other topic without one.
  assert.deepEqual(live.route, {}, 'a global switch must not pin this topic');
  assert.match(said[0], /unorouter\/glm-5\.3:free/);
  // The redrawn card is still in the global mode, so the next tap stays global:
  // dropping back to per-topic would silently undo the mode after one use.
  assert.equal(redrawn.length, 1);
  assert.equal(redrawn[0].scope, 'all');
  assert.ok(redrawn[0].keyboard.flat().some((b) => b.data === 'md:@topic'));
  writeFileSync(patchFile, before, 'utf8');
  assert.equal(readFileSync(patchFile, 'utf8'), before, 'the fixture profile is back as it was');
});