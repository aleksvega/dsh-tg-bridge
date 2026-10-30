import assert from 'node:assert/strict';
import test from 'node:test';
import { handleControl } from '../chat/control.mjs';

const KEY = '1:2';

async function run(state, command, arg, lang = 'en') {
  const replies = [];
  const handled = await handleControl({
    command,
    arg,
    lang,
    key: KEY,
    state,
    config: {},
    reply: (text) => replies.push(text),
    send: async () => {},
    log: () => {},
    saveState: () => {},
  });
  return { handled, text: replies.join('\n') };
}

test('goal and task commands build one checklist', async () => {
  const state = {};
  let r = await run(state, '/goal', 'ship 1.5.0');
  assert.match(r.text, /Goal: ship 1\.5\.0/);
  r = await run(state, '/task', 'write the tests');
  assert.match(r.text, /Task 1 added/);
  assert.match(r.text, /⬜ 1\. write the tests/);
  r = await run(state, '/task', 'done 1');
  assert.match(r.text, /Task 1 done/);
  r = await run(state, '/goal', '');
  assert.match(r.text, /1\/1 tasks done/);
  r = await run(state, '/goal', 'done');
  assert.match(r.text, /Goal closed/);
});

test('commands answer in the topic language', async () => {
  const state = {};
  await run(state, '/goal', 'цель', 'ru');
  const r = await run(state, '/task', 'задача', 'ru');
  assert.match(r.text, /Задача 1 добавлена/);
  assert.match(r.text, /Выполнено 0\/1 задач/);
});

test('task without a goal explains the order', async () => {
  const r = await run({}, '/task', '');
  assert.match(r.text, /No goal yet/);
});
