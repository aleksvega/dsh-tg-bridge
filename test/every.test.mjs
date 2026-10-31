// `/every`: a daily instruction the bridge repeats on the wall clock.
//
// The failure this file is built around is a repeating clock's own: one missed
// morning firing twice after a restart, and a 09:00 that drifts to 10:00 across a
// DST change because the code added 86 400 000 ms instead of asking the wall
// clock. `claimRows` is tested directly because it *is* the answer to "what fires
// now, and where does it land next" — the tick only persists and delivers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import './sandbox-home.mjs';
import { handleControl } from '../chat/control.mjs';
import { CONTROL_COMMANDS, DOCUMENTED_COMMANDS } from '../chat/commands-registry.mjs';
import { LANGS, t } from '../core/i18n.mjs';
import { MAX, chatOf, claimRows, nextAt, parseEvery, syntheticMessage } from '../work/schedules.mjs';
import { runScheduleTick } from '../turn/job-loops.mjs';
import { queues } from '../turn/queue.mjs';

// A fixed local noon: "next 09:00" is tomorrow whatever day the suite runs on.
const NOON = new Date(2026, 9, 25, 12, 0, 0, 0).getTime();

/** The smallest context a command needs, with the save recorded. */
function context({ arg = '', lang = 'en', chatId = 1, threadId = 0, state = {} } = {}) {
  const said = [];
  const saves = [];
  return {
    said,
    saves,
    state,
    ctx: {
      command: '/every',
      arg,
      text: `/every ${arg}`.trim(),
      lang,
      chatId,
      threadId,
      key: `${chatId}:${threadId}`,
      state,
      config: { profile: 'headless', lang: 'en' },
      activeTurns: new Map(),
      saveState: () => saves.push(JSON.parse(JSON.stringify(state.schedules ?? []))),
      log: () => {},
      send: (text) => said.push(String(text)),
      reply: (text) => { said.push(String(text)); return Promise.resolve(0); },
      api: async () => ({}),
      sendFile: async () => {},
      jobs: () => ({ active: [], queued: 0, max: 2 }),
      profile: 'headless',
      prices: () => 'prices',
      stopTurn: () => false,
    },
  };
}

const row = (over = {}) => ({
  id: 'a', chatId: '1', threadId: 0, at: NOON + 60_000, hh: 9, mm: 0, text: 'check the build', lang: 'en', ...over,
});

// ---------------------------------------------------------------- parsing

test('parseEvery reads a wall clock and keeps the text', () => {
  const parsed = parseEvery('09:00 check the build', NOON);
  assert.equal(parsed.at, new Date(2026, 9, 26, 9, 0).getTime());
  assert.equal(parsed.hh, 9);
  assert.equal(parsed.mm, 0);
  assert.equal(parsed.text, 'check the build');
  // A time still ahead today is today.
  assert.equal(parseEvery('18:30 standup', NOON).at, new Date(2026, 9, 25, 18, 30).getTime());
  // Single-digit hour, and the text keeps its inner spacing.
  assert.equal(parseEvery('7:05  two  words ', NOON).text, 'two  words');
});

test('parseEvery refuses what a daily schedule cannot mean', () => {
  assert.deepEqual(parseEvery('', NOON), { error: 'time' });
  assert.deepEqual(parseEvery('noon standup', NOON), { error: 'time' });
  assert.deepEqual(parseEvery('25:00 late', NOON), { error: 'time' });
  // `+15m` is legal for /remind and would quietly mean "every 15 minutes" here.
  assert.deepEqual(parseEvery('+15m tea', NOON), { error: 'time' });
  assert.deepEqual(parseEvery('+1d backup', NOON), { error: 'time' });
  assert.deepEqual(parseEvery('09:00', NOON), { error: 'text' });
  assert.deepEqual(parseEvery('09:00   ', NOON), { error: 'text' });
});

test('nextAt walks the wall clock, so a DST day is 23 or 25 hours', () => {
  // A timezone is fixed for the life of a process, so the DST case is asked in a
  // child process with TZ set; Berlin springs forward on 29 March 2026.
  const url = pathToFileURL(join(import.meta.dirname, '..', 'work', 'schedules.mjs')).href;
  const code = [
    `const { nextAt } = await import(${JSON.stringify(url)});`,
    'const at = (month, day, hour) => new Date(2026, month, day, hour, 0).getTime();',
    'const springRow = { at: at(2, 28, 9), hh: 9, mm: 0 };',
    'const next = nextAt(springRow, at(2, 28, 12));',
    'const when = new Date(next);',
    'console.log(JSON.stringify({ hour: when.getHours(), hours: (next - springRow.at) / 3_600_000 }));',
  ].join('\n');
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, TZ: 'Europe/Berlin' },
    encoding: 'utf8',
  });
  // 09:00 stays 09:00; `at + 86_400_000` would have fired at 10:00, one hour late.
  assert.deepEqual(JSON.parse(out), { hour: 9, hours: 23 });
});

// ------------------------------------------------------- claim and fire

test('claimRows advances a due row into the future and leaves a waiting one alone', () => {
  const waiting = row({ id: 'b', at: NOON + 3_600_000 });
  const due = row({ id: 'a', at: NOON - 1_000 });
  const { rows, claimed } = claimRows([due, waiting], NOON);
  assert.deepEqual(claimed.map((one) => one.id), ['a']);
  assert.equal(rows[1], waiting, 'a row that is not due must not be rewritten');
  assert.equal(rows[0].at, new Date(2026, 9, 26, 9, 0).getTime());
  assert.equal(due.at, NOON - 1_000, 'the input row is not mutated');
  // Claiming is idempotent: the same instant cannot fire the same row twice.
  assert.deepEqual(claimRows(rows, NOON).claimed, []);
  assert.deepEqual(claimRows(undefined, NOON), { rows: [], claimed: [] });
});

test('several missed days are one firing, not one per day', () => {
  const missed = row({ at: new Date(2026, 9, 22, 9, 0).getTime() });
  const { claimed } = claimRows([missed], NOON);
  assert.equal(claimed.length, 1, 'a bridge that was down must catch up once');
  assert.equal(claimed[0].at, new Date(2026, 9, 26, 9, 0).getTime());
  assert.ok(claimed[0].at > NOON);
});

test('the next occurrence is derived from hh/mm even when at is in the past', () => {
  const old = row({ at: new Date(2026, 9, 20, 9, 0).getTime(), hh: 9, mm: 0 });
  assert.equal(nextAt(old, NOON), new Date(2026, 9, 26, 9, 0).getTime());
  // A row written before hh/mm existed still works from its own timestamp.
  const legacy = { at: new Date(2026, 9, 20, 7, 30).getTime() };
  assert.equal(nextAt(legacy, NOON), new Date(2026, 9, 26, 7, 30).getTime());
});

test('a restart fires the missed occurrence once and then nothing', async () => {
  const missed = new Date(2026, 9, 23, 9, 0).getTime();
  const shared = { schedules: [row({ at: missed, threadId: 7 })] };
  let persisted = [];
  const delivered = [];
  const deps = (saved, extra = {}) => ({
    state: shared,
    save: () => { persisted = JSON.parse(JSON.stringify(shared.schedules)); },
    log: () => {},
    probe: async () => {},
    deliver: (one) => delivered.push(one.id),
    ...extra,
  });
  assert.deepEqual(await runScheduleTick(NOON, deps()), ['a']);
  assert.equal(delivered.length, 1, 'the missed morning fires exactly once');
  assert.equal(shared.schedules[0].at, new Date(2026, 9, 26, 9, 0).getTime());
  // The bridge restarts and reads state.json back: same rows, already advanced.
  shared.schedules = JSON.parse(JSON.stringify(persisted));
  assert.deepEqual(await runScheduleTick(NOON, deps()), []);
  assert.equal(delivered.length, 1, 'the restart fired the same occurrence twice');
});

test('the tick hands every due row to the real turn queue', async () => {
  const seen = [];
  const { setMessageHandler } = await import('../turn/queue.mjs');
  setMessageHandler(async (message) => { seen.push(message); });
  const shared = {
    schedules: [
      row({ id: 'a', at: NOON - 1_000, threadId: 7 }),
      row({ id: 'b', at: NOON - 2_000, chatId: '2', text: 'standup' }),
    ],
  };
  const fired = await runScheduleTick(NOON, { state: shared, save: () => {}, log: () => {}, probe: async () => {} });
  assert.deepEqual(fired, ['a', 'b']);
  assert.equal(seen.length, 2);
  const topicTurn = seen.find((message) => message.chat.id === 1);
  assert.equal(topicTurn.text, 'check the build');
  assert.equal(topicTurn.message_thread_id, 7);
  assert.equal(topicTurn.message_id, 0);
  assert.equal(typeof topicTurn.from.id, 'number', 'the allowlist compares by identity');
  assert.ok(!('is_topic_message' in topicTurn), 'the topic-seed flag would post the text twice');
  assert.equal(queues.size, 0, 'the tick left a queue behind');
  setMessageHandler(async () => {});
});

test('a lost topic is one log line and a skip, and the row still advances', async () => {
  const notes = [];
  const delivered = [];
  const shared = { schedules: [row({ at: NOON - 1_000, threadId: 9 })] };
  const fired = await runScheduleTick(NOON, {
    state: shared,
    save: () => {},
    log: (line) => notes.push(line),
    probe: async () => { throw new Error('Bad Request: message thread not found'); },
    deliver: (one) => delivered.push(one.id),
  });
  assert.deepEqual(fired, []);
  assert.deepEqual(delivered, []);
  const logged = notes.join('\n');
  assert.match(logged, /schedule a skipped/);
  assert.match(logged, /topic 9 of chat 1 is gone/);
  assert.match(logged, /message thread not found/);
  assert.ok(shared.schedules[0].at > NOON, 'the next run must not be lost with the topic');
});

test('a delivery that fails is logged and not retried every tick', async () => {
  const notes = [];
  const shared = { schedules: [row({ at: NOON - 1_000 })] };
  const fired = await runScheduleTick(NOON, {
    state: shared,
    save: () => {},
    log: (line) => notes.push(line),
    probe: async () => {},
    deliver: () => { throw new Error('telegram is down'); },
  });
  assert.deepEqual(fired, []);
  assert.match(notes.join('\n'), /schedule a not delivered: telegram is down/);
  assert.ok(shared.schedules[0].at > NOON);
});

test('nothing due means no save and no delivery', async () => {
  const shared = { schedules: [row({ at: NOON + 1_000 })] };
  let saves = 0;
  assert.deepEqual(await runScheduleTick(NOON, {
    state: shared, save: () => { saves += 1; }, log: () => {}, probe: async () => {}, deliver: () => { throw new Error('no'); },
  }), []);
  assert.equal(saves, 0);
});

test('syntheticMessage names the topic only when there is one', () => {
  const general = syntheticMessage(row({ chatId: '42', threadId: 0 }), 99);
  assert.deepEqual(general, { chat: { id: 42 }, from: { id: 99 }, message_id: 0, message_thread_id: undefined, text: 'check the build' });
  assert.equal(syntheticMessage(row({ threadId: '7' }), 1).message_thread_id, 7);
  assert.ok(!('is_topic_message' in syntheticMessage(row(), 1)));
});

test('chatOf keeps one chat and sorts by the next run', () => {
  const rows = [row({ id: 'late', at: NOON + 9_000 }), row({ id: 'other', chatId: '2', at: NOON }), row({ id: 'soon', at: NOON + 1_000 }), null];
  assert.deepEqual(chatOf(rows, 1).map((one) => one.id), ['soon', 'late']);
  assert.deepEqual(chatOf(rows, '2').map((one) => one.id), ['other']);
  assert.deepEqual(chatOf(undefined, 1), []);
});

// -------------------------------------------------------------- the command

test('/every is a documented control command in every language', () => {
  assert.ok(CONTROL_COMMANDS.includes('every'));
  assert.ok(DOCUMENTED_COMMANDS.includes('every'));
  for (const lang of LANGS) {
    for (const key of ['usage', 'title', 'empty', 'line', 'hint', 'added', 'rmDone', 'rmUsage', 'tooMany', 'time', 'text']) {
      assert.notEqual(t(lang, `ctrl.every.${key}`), `ctrl.every.${key}`, `${lang} lacks ctrl.every.${key}`);
    }
    assert.notEqual(t(lang, 'ctrl.help.about.every'), 'ctrl.help.about.every', `${lang} lacks the help sentence`);
  }
});

test('/every adds one row for this topic and says when it runs', async () => {
  const run = context({ arg: '09:00 check the build' });
  assert.equal(await handleControl(run.ctx), true);
  assert.equal(run.state.schedules.length, 1);
  const added = run.state.schedules[0];
  assert.equal(added.chatId, '1');
  assert.equal(added.threadId, 0);
  assert.equal(added.hh, 9);
  assert.equal(added.mm, 0);
  assert.equal(added.text, 'check the build');
  assert.ok(Number(added.at) > Date.now());
  assert.equal(run.saves.length, 1, 'a new schedule is written at once');
  assert.equal(run.said.join('\n'), t('en', 'ctrl.every.added', { when: '09:00', text: 'check the build' }));
});

test('bare /every explains itself in all three languages', async () => {
  for (const lang of LANGS) {
    const run = context({ lang });
    await handleControl(run.ctx);
    const answer = run.said.join('\n');
    assert.equal(answer, t(lang, 'ctrl.every.usage'));
    assert.match(answer, /\/every 09:00/);
    assert.ok(!answer.includes('ctrl.'), `${lang} leaked a key: ${answer}`);
    assert.ok(!/undefined|NaN/.test(answer), `${lang} leaked a value: ${answer}`);
  }
});

test('/every list shows index, next time and text in every language', async () => {
  const rows = [
    row({ id: 'a', at: new Date(2026, 9, 26, 9, 0).getTime(), text: 'build report' }),
    row({ id: 'b', at: new Date(2026, 9, 26, 18, 30).getTime(), hh: 18, mm: 30, text: 'evening check' }),
    row({ id: 'c', at: new Date(2026, 9, 26, 7, 0).getTime(), threadId: 7, text: 'other topic' }),
    row({ id: 'd', chatId: '2', at: NOON, text: 'other chat' }),
  ];
  for (const lang of LANGS) {
    const run = context({ arg: 'list', lang, state: { schedules: rows } });
    await handleControl(run.ctx);
    const answer = run.said.join('\n');
    assert.ok(!answer.includes('ctrl.'), `${lang} leaked a key: ${answer}`);
    assert.ok(!/undefined|NaN/.test(answer), `${lang} leaked a value: ${answer}`);
    assert.equal(answer.split('\n')[0], t(lang, 'ctrl.every.title'));
    // The order is the next run, so 07:00 comes first; each line carries its
    // own index, time and text, and a topic row names the topic.
    assert.match(answer, /1\.[^\n]*07:00[^\n]*other topic/);
    assert.match(answer, /2\.[^\n]*09:00[^\n]*build report/);
    assert.match(answer, /3\.[^\n]*18:30[^\n]*evening check/);
    assert.ok(!answer.includes('other chat'), 'a list must not show another chat');
    assert.ok(answer.includes(t(lang, 'ctrl.every.topicLabel', { thread: 7 })), `${lang} hid the other topic`);
    assert.match(answer, /\/every rm 1/);
  }
});

test('an empty list says so, and the hint still teaches the command', async () => {
  for (const lang of LANGS) {
    const run = context({ arg: 'list', lang });
    await handleControl(run.ctx);
    const answer = run.said.join('\n');
    assert.ok(answer.includes(t(lang, 'ctrl.every.empty')));
    assert.ok(answer.includes(t(lang, 'ctrl.every.hint')));
    assert.ok(!answer.includes('ctrl.'));
  }
});

test('/every rm removes exactly the numbered row and nothing else', async () => {
  const state = { schedules: [
    row({ id: 'a', at: NOON + 1_000, text: 'first' }),
    row({ id: 'b', at: NOON + 2_000, text: 'second' }),
    row({ id: 'c', chatId: '2', at: NOON + 3_000, text: 'another chat' }),
  ] };
  const run = context({ arg: 'rm 2', state });
  await handleControl(run.ctx);
  assert.deepEqual(state.schedules.map((one) => one.id), ['a', 'c']);
  assert.equal(run.saves.length, 1);
  assert.equal(run.said.join('\n'), t('en', 'ctrl.every.rmDone', { n: 2, text: 'second' }));
  for (const bad of ['rm', 'rm 0', 'rm 9', 'rm two', 'delete 9']) {
    const refused = context({ arg: bad, state });
    await handleControl(refused.ctx);
    assert.equal(state.schedules.length, 2, `/every ${bad} removed a row`);
    assert.equal(refused.said.join('\n'), t('en', 'ctrl.every.rmUsage'), `/every ${bad} did not explain itself`);
    assert.equal(refused.saves.length, 0);
  }
});

test('the per-chat cap refuses with the number, and another chat still has room', async () => {
  const state = { schedules: [] };
  for (let index = 0; index < MAX; index += 1) {
    state.schedules.push(row({ id: `s${index}`, threadId: index % 2, at: NOON + index, text: `row ${index}` }));
  }
  const full = context({ arg: '09:00 one more', state });
  await handleControl(full.ctx);
  assert.equal(state.schedules.length, MAX);
  assert.equal(full.saves.length, 0);
  assert.equal(full.said.join('\n'), t('en', 'ctrl.every.tooMany', { max: MAX }));
  const other = context({ arg: '09:00 fresh chat', chatId: 2, state });
  await handleControl(other.ctx);
  assert.equal(state.schedules.length, MAX + 1);
});

test('a malformed line is answered as malformed even when the list is full', async () => {
  const state = { schedules: [] };
  for (let index = 0; index < MAX; index += 1) state.schedules.push(row({ id: `s${index}`, at: NOON + index }));
  const noText = context({ arg: '09:00', state });
  await handleControl(noText.ctx);
  assert.equal(noText.said.join('\n'), t('en', 'ctrl.every.text'));
  const relative = context({ arg: '+15m tea', state });
  await handleControl(relative.ctx);
  assert.equal(relative.said.join('\n'), t('en', 'ctrl.every.time'));
  assert.equal(state.schedules.length, MAX);
});