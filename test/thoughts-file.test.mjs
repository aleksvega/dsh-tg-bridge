// `/thoughts file` writes a real Markdown log and sends it as a document. The
// command reads DSH_HOME at import time, so the home is a temp dir here and the
// module is imported dynamically — the point is to exercise the file path, not
// to touch the live one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';

const home = mkdtempSync(join(tmpdir(), 'dsh-thoughts-'));
process.env.DSH_HOME = home;
process.env.DSH_TELEGRAM_BOT_TOKEN = 'test-token';

const { lastTurnReasoningSteps, reasoningMarkdown, sessionReasoningSteps } = await import('../chat/thoughts.mjs');
const { handleControl } = await import('../chat/control.mjs');

/** A session log the way the CLI writes it: one zstd frame per appended batch. */
function writeSession(records) {
  const frames = records.map((batch) => zstdCompressSync(Buffer.from(`${batch.map((r) => JSON.stringify(r)).join('\n')}\n`)));
  const dir = join(home, 'sessions', 'proj', 'session-abc');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'session.v4.jsonl.zstd');
  writeFileSync(file, Buffer.concat(frames));
  return file;
}

const reasoning = (text) => ({ type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text }] } } });
const file = writeSession([
  [{ type: 'session', createdAt: 1 }, { type: 'turn/start' }, reasoning('первый шаг'), reasoning('второй шаг')],
  [{ type: 'turn/start' }, reasoning('рассуждение второго хода')],
]);

test('the last turn keeps every step, not a capped slice', () => {
  assert.deepEqual(lastTurnReasoningSteps(file), ['рассуждение второго хода']);
});

test('the whole session is split by turn, oldest first', () => {
  assert.deepEqual(sessionReasoningSteps(file), [
    { steps: ['первый шаг', 'второй шаг'] },
    { steps: ['рассуждение второго хода'] },
  ]);
});

test('the Markdown log numbers steps and keeps the text verbatim', () => {
  const md = reasoningMarkdown({
    title: 'Reasoning',
    meta: ['2026-10-25 21:40', '3 steps'],
    stepTitle: 'Step',
    turns: [{ steps: ['a < b', 'второй'] }, { steps: ['третий'] }],
  });
  assert.match(md, /^# Reasoning\n\n- 2026-10-25 21:40\n- 3 steps\n/);
  assert.match(md, /## Step 1\n\n### Step 1\n\na < b/);
  assert.match(md, /## Step 2\n\n### Step 1\n\nтретий/);
});

/** The minimum a control handler needs, with the document call recorded. */
function context(sent) {
  return {
    command: '/thoughts',
    arg: 'file',
    text: '/thoughts file',
    chatId: 1,
    threadId: 2,
    key: '1:2',
    state: { sessions: { '1:2': 'session-abc' }, profiles: {}, lang: {}, thinkBlock: {} },
    config: { profile: 'headless' },
    lang: 'ru',
    activeTurns: new Map(),
    saveState: () => {},
    log: () => {},
    send: (m) => sent.push(m),
    reply: (m) => sent.push(m),
    api: async () => ({}),
    sendFile: async (path, caption) => {
      sent.push({ path, caption, text: readFileSync(path, 'utf8') });
    },
    prices: () => '',
  };
}

test('/thoughts file sends one Markdown document with the whole last turn', async () => {
  const sent = [];
  assert.equal(await handleControl(context(sent)), true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].path, /reasoning-.*-file\.md$/);
  assert.match(sent[0].text, /# Размышления последнего хода/);
  assert.match(sent[0].text, /рассуждение второго хода/);
  assert.match(sent[0].caption, /символов/);
});

test('/thoughts all writes every turn of the session into the file', async () => {
  const sent = [];
  await handleControl({ ...context(sent), arg: 'all', text: '/thoughts all' });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /## Ход 1[\s\S]*первый шаг[\s\S]*## Ход 2[\s\S]*рассуждение второго хода/);
});

test('/thoughts off hides the block and /thoughts on brings it back', async () => {
  const sent = [];
  const ctx = { ...context(sent), arg: 'off', text: '/thoughts off' };
  await handleControl(ctx);
  assert.equal(ctx.state.thinkBlock['1:2'], 'counter');
  await handleControl({ ...ctx, arg: 'on', text: '/thoughts on' });
  assert.equal(ctx.state.thinkBlock['1:2'], undefined);
  assert.match(sent.join('\n'), /выключен[\s\S]*снова/);
});
