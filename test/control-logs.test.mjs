import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SANDBOX_HOME } from './sandbox-home.mjs';
import { handleControl, filterLogLines } from '../control.mjs';

// `/logs file` stats the bridge log. Point it at a file this test owns: on a
// machine that has run the bridge the real log exists and hides the branch that
// answers when it does not, which is how CI caught this and a laptop did not.
mkdirSync(join(SANDBOX_HOME, 'tg-bridge'), { recursive: true });
writeFileSync(join(SANDBOX_HOME, 'tg-bridge', 'bridge.log'), '2026-10-25T10:00:00.000Z bridge started\n');

const LOG = [
  '2026-10-25T10:00:00.000Z bridge started',
  '2026-10-25T10:00:01.000Z bot @some_bot',
  '2026-10-25T10:00:02.000Z sent chat=1 msg=2 len=40 html',
  '2026-10-25T10:00:03.000Z turn start chat=1 thread=0',
  '2026-10-25T10:00:04.000Z   tool[7] pwsh: npm test',
  '2026-10-25T10:00:05.000Z   tool[7] ОШИБКА exit 1',
  '2026-10-25T10:00:06.000Z turn failed 1 topic=0 3s tools=1',
  '2026-10-25T10:00:07.000Z poll error [TG_POLL]: 409 Conflict',
  '2026-10-25T10:00:08.000Z FATAL unhandled rejection: ReferenceError: x',
  '2026-10-25T10:00:09.000Z heard a voice note',
];

test('the default log view hides delivery chatter and keeps the work', () => {
  const { pool, tail } = filterLogLines(LOG, '', 30);
  assert.equal(tail.length, pool.length);
  assert.deepEqual(pool, LOG.filter((l) => /turn|tool|FATAL|poll|voice/.test(l)));
});

test('/logs errors keeps bridge faults and drops tool results', () => {
  const { pool } = filterLogLines(LOG, 'errors', 30);
  assert.equal(pool.length, 3);
  assert.ok(pool.every((l) => !l.includes('tool[')));
  assert.ok(pool.some((l) => l.includes('turn failed')));
  assert.ok(pool.some((l) => l.includes('FATAL')));
  assert.ok(pool.some((l) => l.includes('poll error')));
});

test('/logs <text> is a plain case-insensitive search', () => {
  const { pool } = filterLogLines(LOG, 'VOICE', 30);
  assert.deepEqual(pool, ['2026-10-25T10:00:09.000Z heard a voice note']);
});

test('the tail honours the requested count', () => {
  const { pool, tail } = filterLogLines(LOG, '', 2);
  assert.equal(pool.length, 7);
  assert.deepEqual(tail, pool.slice(-2));
});

test('/logs file sends the file itself instead of pasting it', async () => {
  const sent = [];
  const ctx = {
    command: '/logs',
    arg: 'file',
    text: '/logs file',
    chatId: 1,
    threadId: 0,
    key: '1:0',
    state: { sessions: {}, profiles: {}, lang: {} },
    config: { profile: 'headless' },
    profile: 'headless',
    lang: 'ru',
    activeTurns: new Map(),
    saveState() {},
    log() {},
    send: (m) => sent.push(['send', m]),
    reply: (m) => {
      sent.push(['reply', m]);
      return 1;
    },
    api: async () => ({}),
    sendFile: async (path, caption) => sent.push(['file', path, caption]),
    stopTurn: () => false,
    seedTopic: async () => {},
    prices: () => '',
  };
  assert.equal(await handleControl(ctx), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'file');
  assert.match(sent[0][1], /bridge\.log$/);
  assert.match(sent[0][2], /bridge\.log/);
});

test('/logs file says so when the build cannot send files', async () => {
  const out = [];
  const ctx = {
    command: '/logs',
    arg: 'file',
    text: '/logs file',
    chatId: 1,
    threadId: 0,
    key: '1:0',
    state: { sessions: {}, profiles: {}, lang: {} },
    config: { profile: 'headless' },
    profile: 'headless',
    lang: 'ru',
    activeTurns: new Map(),
    saveState() {},
    log() {},
    send: (m) => out.push(m),
    reply: (m) => {
      out.push(m);
      return 1;
    },
    api: async () => ({}),
    stopTurn: () => false,
    seedTopic: async () => {},
    prices: () => '',
  };
  assert.equal(await handleControl(ctx), true);
  assert.equal(out.length, 1);
  assert.match(out[0], /файл/i);
});
