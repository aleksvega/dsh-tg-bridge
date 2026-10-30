// A task card is a tap, so the toggle has to be its own inverse and a closed
// goal must stay closed; a stray press may never reopen finished work.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTask, finishGoal, goalOf, progressOf, setGoal, toggleTask } from '../work/goals.mjs';

const KEY = '111:222';

function seed() {
  const state = {};
  setGoal(state, KEY, 'ship the bridge');
  addTask(state, KEY, 'write the card');
  addTask(state, KEY, 'run the linter');
  return state;
}

test('a tap closes a task and the next tap reopens it', () => {
  const state = seed();
  assert.equal(progressOf(goalOf(state, KEY)).done, 0);
  toggleTask(state, KEY, 2);
  assert.equal(goalOf(state, KEY).tasks[1].done, true);
  assert.equal(progressOf(goalOf(state, KEY)).done, 1);
  toggleTask(state, KEY, 2);
  assert.equal(goalOf(state, KEY).tasks[1].done, false);
  assert.equal(progressOf(goalOf(state, KEY)).done, 0);
});

test('a tap touches exactly one task', () => {
  const state = seed();
  toggleTask(state, KEY, 1);
  assert.deepEqual(goalOf(state, KEY).tasks.map((t) => t.done), [true, false]);
});

test('a number that is gone is refused, not clamped', () => {
  const state = seed();
  assert.equal(toggleTask(state, KEY, 0), null);
  assert.equal(toggleTask(state, KEY, 3), null);
  assert.equal(toggleTask(state, KEY, 99), null);
  assert.equal(toggleTask(state, KEY, 'abc'), null);
  assert.equal(toggleTask({}, KEY, 1), null, 'no goal at all');
  assert.deepEqual(goalOf(state, KEY).tasks.map((t) => t.done), [false, false]);
});

test('a closed goal cannot be reopened by a tap', () => {
  const state = seed();
  finishGoal(state, KEY);
  assert.equal(toggleTask(state, KEY, 1), null);
  assert.equal(goalOf(state, KEY).done, true);
});