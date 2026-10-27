// `/tasks` was an alias of `/task`, which made the tappable checklist
// unreachable: the card is what the README advertises, and `/tasks 1` — the
// obvious way to mean "task 1" — added a task whose text was "1". The keyboard
// also refused to appear below three tasks, which is the size most goals have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './sandbox-home.mjs';
import { COMMAND_ALIASES, handleControl } from '../control.mjs';

function harness(tasks) {
  const out = [];
  const state = { sessions: {}, profiles: {}, lang: {}, goals: { '1:2': { text: 'Ship it', done: false, tasks } } };
  const ctx = (command, arg) => ({
    command,
    arg,
    text: `${command}${arg ? ` ${arg}` : ''}`,
    chatId: 1,
    threadId: 2,
    key: '1:2',
    state,
    config: { profile: 'headless' },
    profile: 'headless',
    lang: 'en',
    activeTurns: new Map(),
    saveState() {},
    log() {},
    send: (m) => out.push({ text: String(m) }),
    reply: (m, extra) => {
      out.push({ text: String(m), keyboard: extra?.keyboard });
      return 1;
    },
    api: async () => ({}),
    sendFile: async () => {},
    stopTurn: () => false,
    seedTopic: async () => {},
    prices: () => '',
  });
  return { out, state, ctx };
}

test('/tasks is its own command, not an alias of /task', () => {
  assert.equal(COMMAND_ALIASES.tasks, undefined);
});

test('a one-task goal still gets the tap card', async () => {
  const { out, ctx } = harness([{ text: 'only one', done: false }]);
  await handleControl(ctx('/tasks', ''));
  assert.equal(out.length, 1);
  assert.match(out[0].text, /1\. only one/);
  assert.ok(out[0].keyboard?.length, 'the card must carry buttons even for a single task');
});

test('/tasks 1 shows the list and adds nothing', async () => {
  const { out, state, ctx } = harness([{ text: 'a', done: false }, { text: 'b', done: false }]);
  await handleControl(ctx('/tasks', '1'));
  assert.equal(state.goals['1:2'].tasks.length, 2, 'no task may be invented from an argument');
  assert.match(out[0].text, /2\. b/);
  assert.match(out[0].text, /\/task done\|rm\|edit/, 'the hint says which command does change the list');
});
