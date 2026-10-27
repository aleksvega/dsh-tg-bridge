// `/task` and `/goal` answered with the same card, so a person learned nothing
// about which command owns what and had to remember that they were synonyms.
// `/goal` is the plan; `/task` is the list you tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './sandbox-home.mjs';
import { handleControl } from '../control.mjs';

function run(command) {
  const out = [];
  const ctx = {
    command,
    arg: '',
    text: command,
    chatId: 1,
    threadId: 2,
    key: '1:2',
    state: {
      sessions: {},
      profiles: {},
      lang: {},
      goals: { '1:2': { text: 'Ship the bridge', done: false, tasks: [{ text: 'write tests', done: true }, { text: 'publish', done: false }] } },
    },
    config: { profile: 'headless' },
    profile: 'headless',
    lang: 'en',
    activeTurns: new Map(),
    saveState() {},
    log() {},
    send: (m) => out.push(m),
    reply: (m) => {
      out.push(m);
      return 1;
    },
    api: async () => ({}),
    sendFile: async () => {},
    stopTurn: () => false,
    seedTopic: async () => {},
    prices: () => '',
  };
  return handleControl(ctx).then(() => out.join('\n'));
}

test('/goal shows the objective, /task shows only the checklist', async () => {
  const goal = await run('/goal');
  const task = await run('/task');

  assert.match(goal, /Ship the bridge/);
  assert.match(goal, /1\. write tests/);
  assert.match(task, /Tasks \(1\/2\)/);
  assert.match(task, /2\. publish/);
  assert.doesNotMatch(task, /Ship the bridge/, 'the task list must not repeat the goal wording');
  assert.notEqual(goal, task);
});