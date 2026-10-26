import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The command resolves agentsets.json from DSH_TG_HOME at call time, so the
// whole file gets its own scratch directory before the module is imported.
const home = mkdtempSync(join(tmpdir(), 'agentset-cmd-'));
process.env.DSH_TG_HOME = home;
const { handleControl } = await import('../control.mjs');
const { AgentsetStore } = await import('../agentsets.mjs');

function context(overrides = {}) {
  const out = [];
  const ctx = {
    command: '/agentset',
    arg: '',
    text: '/agentset',
    chatId: 1,
    threadId: 2,
    key: '1:2',
    state: { sessions: {}, profiles: {}, lang: {}, agentsets: {} },
    config: { profile: 'headless' },
    profile: 'headless',
    lang: 'ru',
    activeTurns: new Map(),
    saveState: () => {},
    log: () => {},
    send: (m) => out.push(m),
    reply: (m) => {
      out.push(m);
      return 1;
    },
    api: async () => ({}),
    sendFile: async () => {},
    stopTurn: () => false,
    seedTopic: async () => {},
    prices: () => 'prices',
    ...overrides,
  };
  return { ctx, out };
}

async function run(arg, overrides = {}, shared = {}) {
  // A command call is a round trip through the bridge: the same state object
  // comes back in, so keep it unless the caller wants a fresh one.
  const state = overrides.state || shared.state || { sessions: {}, profiles: {}, lang: {}, agentsets: {} };
  shared.state = state;
  const { ctx, out } = context({ ...overrides, state });
  assert.equal(await handleControl({ ...ctx, arg, text: `/agentset ${arg}`.trim() }), true);
  assert.equal(out.length, 1, 'exactly one reply');
  return { text: out[0], ctx };
}

test('the bare command lists the builtins and says which set is bound', async () => {
  const { text } = await run('');
  for (const id of ['normal', 'careful', 'fast', 'reviewer']) assert.match(text, new RegExp(id));
  assert.match(text, /Набор не привязан/);
});

test('a builtin can be bound, edited into a copy, and removed only when free', async () => {
  const shared = {};
  const bound = await run('use careful', {}, shared);
  assert.equal(bound.ctx.state.agentsets['1:2'], 'careful');
  assert.match(bound.text, /Careful/);

  const card = await run('show', {}, shared);
  assert.match(card.text, /привязан к этой теме/);
  assert.match(card.text, /read-only/);

  const readonly = await run('model glm-5.3', {}, shared);
  assert.match(readonly.text, /только для чтения/);

  const copy = await run('copy mine careful', {}, shared);
  assert.match(copy.text, /mine/);
  assert.equal(new AgentsetStore(join(home, 'agentsets.json')).load().get('mine').permissions, 'read-only');

  const edited = await run('model glm-5.3 mine', {}, shared);
  assert.match(edited.text, /glm-5\.3/);
  assert.equal(new AgentsetStore(join(home, 'agentsets.json')).load().get('mine').model, 'glm-5.3');

  const cleared = await run('model inherit mine', {}, shared);
  assert.equal(new AgentsetStore(join(home, 'agentsets.json')).load().get('mine').model, '');
  assert.match(cleared.text, /из профиля/);

  const busy = await run('rm careful', {}, shared);
  assert.match(busy.text, /привязан к темам/);
});

test('detaching returns the topic to its profile and is idempotent', async () => {
  const state = { sessions: {}, agentsets: { '1:2': 'fast' } };
  const off = await run('off', { state });
  assert.equal(state.agentsets['1:2'], undefined);
  assert.match(off.text, /headless/);
  assert.match((await run('off', { state })).text, /Уже так/);
});

test('an unknown set, a bad name and a bad field are answered, not thrown', async () => {
  assert.match((await run('show nope')).text, /Набора «nope» нет/);
  assert.match((await run('new')).text, /только для чтения|строчные/);
  const bad = await run('temperature 0.2');
  assert.match(bad.text, /Поля «temperature» нет/);
  assert.match(bad.text, /model, effort, permissions, preset, lang, notes/);
});

test('use applies the set language to the topic and persists it', async () => {
  let saved = 0;
  const state = { sessions: {}, agentsets: {} };
  const { ctx, out } = context({ state, lang: 'en', saveState: () => (saved += 1) });
  let last = '';
  for (const arg of ['new spoken from fast', 'lang ru spoken', 'use spoken']) {
    out.length = 0;
    assert.equal(await handleControl({ ...ctx, arg }), true);
    last = out.join('\n');
  }
  assert.equal(state.agentsets['1:2'], 'spoken');
  assert.equal(state.lang['1:2'], 'ru', 'a set carrying a language sets it for the topic');
  assert.ok(saved >= 1, 'binding and language are persisted');
  assert.match(last, /spoken/);
});

test('the card marks a field the profile does not declare instead of failing', async () => {
  const { text } = await run('show normal');
  assert.doesNotMatch(text, /undefined|null/);
  assert.match(text, /Набор: Normal/);
});

// Cleanup last: node:test runs files in isolation, but the scratch dir should
// not outlive the process on Windows either.
test('scratch directory', () => {
  rmSync(home, { recursive: true, force: true });
  assert.ok(true);
});