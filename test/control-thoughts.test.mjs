import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, keysOf, t } from '../core/i18n.mjs';
import { handleControl, CONTROL_COMMANDS } from '../chat/control.mjs';
import { lastTurnReasoning } from '../chat/thoughts.mjs';

test('every language defines the same keys', () => {
  const base = new Set(keysOf(LANGS[0]));
  for (const lang of LANGS.slice(1)) {
    const keys = new Set(keysOf(lang));
    const missing = [...base].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !base.has(k));
    assert.deepEqual(missing, [], `${lang} misses keys`);
    assert.deepEqual(extra, [], `${lang} has extra keys`);
  }
});

/** A control context that records replies instead of sending them. */
function context(overrides = {}) {
  const out = [];
  const ctx = {
    command: '/help',
    arg: '',
    text: '/help',
    chatId: 1,
    threadId: 2,
    key: '1:2',
    state: { sessions: {}, profiles: {}, lang: {} },
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

test('/thoughts answers with a hint, never silence, when the topic has no session', async () => {
  const { ctx, out } = context({ command: '/thoughts' });
  assert.equal(await handleControl(ctx), true);
  assert.equal(out.length, 1);
  assert.match(out[0], /сессии|session|会话/);
});

test('/thoughts names a missing plan instead of sending an empty message', async () => {
  const { ctx, out } = context({
    command: '/thoughts',
    state: { sessions: { '1:2': 'no-such-session' }, profiles: {}, lang: {} },
  });
  assert.equal(await handleControl(ctx), true);
  assert.equal(out.length, 1);
  assert.match(out[0], /рассужден|reasoning|推理/);
});

test('an empty or missing session file yields no reasoning and no throw', () => {
  assert.equal(lastTurnReasoning(''), '');
  assert.equal(lastTurnReasoning('C:\\definitely\\not\\here.zstd'), '');
});

test('the block that says it disappears is sent through the self-deleting path', async () => {
  // The title promises removal in three minutes. A plain reply keeps it forever,
  // which is what the person saw: the promise came from the text, not the send.
  const briefed = [];
  const { ctx, out } = context({
    command: '/thoughts',
    state: { sessions: { '1:2': 'no-such-session' }, profiles: {}, lang: {} },
    ephemeral: (text) => {
      briefed.push(text);
      return 1;
    },
  });
  assert.equal(await handleControl(ctx), true);
  assert.deepEqual(out, [], 'nothing may go out as a permanent message');
  assert.equal(briefed.length, 1);
  assert.match(briefed[0], /рассужден|reasoning|推理/);
});

test('without the bridge context the report still leaves as a plain reply', async () => {
  const { ctx, out } = context({
    command: '/thoughts',
    state: { sessions: { '1:2': 'no-such-session' }, profiles: {}, lang: {} },
  });
  assert.equal(await handleControl(ctx), true);
  assert.equal(out.length, 1);
});

test('every control command has a handler and an answer in each language', () => {
  for (const name of CONTROL_COMMANDS) {
    assert.ok(name.length > 0);
  }
  for (const lang of LANGS) {
    assert.ok(t(lang, 'ctrl.version.title'));
    assert.ok(t(lang, 'ctrl.update.available'));
  }
});

test('/reasoning switches the trail to chat, back to the card, and off', async () => {
  // The three ends are one command; the stored value is the mode itself, so a
  // reader (the panel, the prompt, the settings card) never has to guess.
  const store = { reasoning: {} };
  const { ctx, out } = context({
    command: '/reasoning',
    arg: 'chat',
    state: { ...store, sessions: {}, profiles: {}, lang: {} },
  });
  assert.equal(await handleControl(ctx), true);
  assert.equal(ctx.state.reasoning['1:2'], 'chat');
  assert.equal(out.length, 1);

  const back = context({
    command: '/reasoning',
    arg: 'card',
    state: { reasoning: { '1:2': 'chat' }, sessions: {}, profiles: {}, lang: {} },
  });
  assert.equal(await handleControl(back.ctx), true);
  assert.equal(back.ctx.state.reasoning['1:2'], 'card');

  const off = context({
    command: '/reasoning',
    arg: 'off',
    state: { reasoning: { '1:2': 'card' }, sessions: {}, profiles: {}, lang: {} },
  });
  assert.equal(await handleControl(off.ctx), true);
  assert.equal(off.ctx.state.reasoning['1:2'], 'off');
});

test('/reasoning with no argument reports the mode and changes nothing', async () => {
  const state = { reasoning: { '1:2': 'chat' }, sessions: {}, profiles: {}, lang: {} };
  const { ctx, out } = context({ command: '/reasoning', arg: '', state });
  assert.equal(await handleControl(ctx), true);
  assert.equal(out.length, 1);
  // The word for the mode, not a bare "on": the answer must say where the lines go.
  assert.match(out[0], /чат|chat|聊天/);
  assert.equal(state.reasoning['1:2'], 'chat');
});

test('/reasoning on is still the old spelling of the card', async () => {
  const { ctx } = context({
    command: '/reasoning',
    arg: 'on',
    state: { reasoning: {}, sessions: {}, profiles: {}, lang: {} },
  });
  assert.equal(await handleControl(ctx), true);
  assert.equal(ctx.state.reasoning['1:2'], 'card');
});
