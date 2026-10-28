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

test('/tasks 1 ticks that task, and adds nothing', async () => {
  // A bare number is the obvious way to say "task 1", so it means exactly that —
  // it used to add a task literally named "1", which is why `/tasks` had to be
  // split off from `/task`. One command now handles both forms.
  const { out, state, ctx } = harness([{ text: 'a', done: false }, { text: 'b', done: false }]);
  await handleControl(ctx('/tasks', '1'));
  assert.equal(state.goals['1:2'].tasks.length, 2, 'no task may be invented from an argument');
  assert.equal(state.goals['1:2'].tasks[0].done, true, 'the number names the task to tick');
  assert.match(out[0].text, /Task 1 done/);
  assert.match(out.at(-1).text, /2\. b/, 'the card comes back, redrawn');
  assert.ok(out.at(-1).keyboard?.length, 'and it is still tappable');
});
