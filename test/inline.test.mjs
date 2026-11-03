// Inline mode: what `@bot rew` answers, and what picking a result does.
//
// Two promises are asserted here rather than assumed: the list comes from the
// registry alone (so a stranger learns the command names and nothing else, and
// every requester gets the same rows), and a chosen hint cannot run anything —
// its text is not a command, and a message that arrives through the bot is
// dropped before it reaches a turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-inline-'));
process.env.DSH_HOME = HOME;
mkdirSync(join(HOME, 'profiles', 'headless'), { recursive: true });

const { aboutCommand, hintText, inlinePayload, inlineResults, sentThroughUs, takeInlineQuery } = await import('../chat/inline.mjs');
const { setBotUsername } = await import('../chat/commands.mjs');

test('a prefix offers the commands that start with it', () => {
  const rows = inlineResults('rew', 'en');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, '/rewind');
  assert.ok(rows[0].description.length > 0, 'the row carries the usage line');
  assert.ok(rows[0].description.length <= 100, 'Telegram cuts anything longer');
  // The text a tap posts is the syntax, not a command: nothing to execute.
  assert.doesNotMatch(rows[0].input_message_content.message_text, /^\//);
  assert.match(rows[0].input_message_content.message_text, /^rewind — /);
});

test('a leading slash is not required and case does not matter', () => {
  const typed = inlineResults('/REW', 'en').map((r) => r.id);
  assert.deepEqual(typed, ['rewind']);
});

test('twenty rows at most, in the order /help lists them', () => {
  const all = inlineResults('', 'en');
  assert.equal(all.length, 20);
  assert.equal(all[0].id, 'start');
  const many = inlineResults('s', 'en');
  assert.ok(many.length <= 20);
  assert.ok(many.length > 1);
});

test('nothing matched answers the hub instead of a blank list', () => {
  const payload = inlinePayload('zzz', 'ru');
  assert.deepEqual(payload.results, []);
  assert.equal(payload.switch_pm_parameter, 'help');
  assert.ok(payload.switch_pm_text.length > 0);
  // Cached across requesters, so everyone sees the same rows.
  assert.equal(payload.is_personal, false);
});

test('the same query answers the same for every requester', () => {
  assert.deepEqual(inlinePayload('mo', 'en'), inlinePayload('mo', 'en'));
  const dump = JSON.stringify(inlinePayload('mo', 'en'));
  assert.doesNotMatch(dump, /\d{6,}/, 'no chat id leaks into a suggestion');
  assert.doesNotMatch(dump, /session|workspace|DSH_HOME/i);
});

test('three locales, no raw keys', () => {
  const en = aboutCommand('rewind', 'en');
  const ru = aboutCommand('rewind', 'ru');
  const zh = aboutCommand('rewind', 'zh');
  for (const [lang, text] of [['en', en], ['ru', ru], ['zh', zh]]) {
    assert.ok(text.length > 0, `${lang} has a sentence`);
    assert.doesNotMatch(text, /^ctrl\.|^help\./, `${lang} resolved its key`);
  }
  assert.notEqual(ru, en);
  assert.notEqual(zh, en);
});

test('a row falls back to its section when the command has no sentence of its own', () => {
  const text = aboutCommand('every', 'en');
  assert.ok(text.length > 0);
  assert.doesNotMatch(text, /^ctrl\./);
});

test('a hint posts the syntax, never a runnable command', () => {
  assert.equal(hintText('rewind', 'en').startsWith('/'), false);
  for (const name of ['edit', 'mcp', 'plan']) {
    assert.doesNotMatch(hintText(name, 'ru'), /^\//);
  }
});

test('only our own inline hints are recognised as documentation', () => {
  setBotUsername('deepifiya_bot');
  assert.equal(sentThroughUs({ via_bot: { username: 'deepifiya_bot' } }), true);
  assert.equal(sentThroughUs({ via_bot: { username: 'DEEPIFIYA_BOT' } }), true);
  assert.equal(sentThroughUs({ via_bot: { username: 'other_bot' } }), false);
  assert.equal(sentThroughUs({ text: '/rewind 2' }), false);
  setBotUsername('');
  assert.equal(sentThroughUs({ via_bot: { username: 'deepifiya_bot' } }), false, 'unknown name matches nothing');
});

test('an inline query is answered and the offset moves past it', async () => {
  const state = { offset: 10 };
  const calls = [];
  let saved = 0;
  await takeInlineQuery({
    update: { update_id: 41, inline_query: { id: 'q1', query: 'rew' } },
    tg: async (method, args) => { calls.push([method, args]); },
    state,
    config: { lang: 'en' },
    log: () => {},
    save: () => { saved += 1; },
  });
  assert.equal(state.offset, 42);
  assert.equal(saved, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'answerInlineQuery');
  assert.equal(calls[0][1].inline_query_id, 'q1');
  assert.equal(calls[0][1].results[0].title, '/rewind');
});

test('a failing answer is logged, not thrown at the poller', async () => {
  const seen = [];
  await takeInlineQuery({
    update: { update_id: 1, inline_query: { id: 'q2', query: '' } },
    tg: async () => { throw new Error('query is too old'); },
    state: { offset: 1 },
    config: { lang: 'ru' },
    log: (line) => seen.push(line),
    save: () => {},
  });
  assert.match(seen.join('\n'), /inline answer failed: query is too old/);
});