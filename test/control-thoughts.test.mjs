import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, keysOf, t } from '../i18n.mjs';
import { handleControl, CONTROL_COMMANDS } from '../control.mjs';
import { lastTurnReasoning } from '../thoughts.mjs';

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

test('every control command has a handler and an answer in each language', () => {
  for (const name of CONTROL_COMMANDS) {
    assert.ok(name.length > 0);
  }
  for (const lang of LANGS) {
    assert.ok(t(lang, 'ctrl.version.title'));
    assert.ok(t(lang, 'ctrl.update.available'));
  }
});
