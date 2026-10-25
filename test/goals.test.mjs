import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  addTask, applyGoalJob, clearGoal, doneTask, drainGoalJobs, finishGoal,
  goalOf, progressOf, removeTask, renderPromptBlock, setGoal,
} from '../goals.mjs';

const KEY = '42:7';

test('set, add, done and progress', () => {
  const state = {};
  setGoal(state, KEY, 'ship 1.5.0');
  addTask(state, KEY, 'write tests');
  addTask(state, KEY, 'update README');
  assert.equal(progressOf(goalOf(state, KEY)).total, 2);
  assert.equal(doneTask(state, KEY, 1), true);
  assert.deepEqual(progressOf(goalOf(state, KEY)), { done: 1, total: 2 });
  assert.equal(doneTask(state, KEY, 9), false);
  assert.equal(removeTask(state, KEY, 2), true);
  assert.equal(goalOf(state, KEY).tasks.length, 1);
});

test('setting a new goal keeps the task list', () => {
  const state = {};
  setGoal(state, KEY, 'old');
  addTask(state, KEY, 'task');
  setGoal(state, KEY, 'new');
  assert.equal(goalOf(state, KEY).text, 'new');
  assert.equal(goalOf(state, KEY).tasks.length, 1);
});

test('finish marks every task done and clear removes the goal', () => {
  const state = {};
  setGoal(state, KEY, 'goal');
  addTask(state, KEY, 'a');
  finishGoal(state, KEY);
  assert.equal(goalOf(state, KEY).done, true);
  assert.equal(progressOf(goalOf(state, KEY)).done, 1);
  assert.equal(clearGoal(state, KEY), true);
  assert.equal(goalOf(state, KEY), null);
});

test('tasks need a goal unless the job creates one', () => {
  const state = {};
  assert.equal(addTask(state, KEY, 'orphan'), null);
  assert.equal(applyGoalJob(state, { key: KEY, op: 'add', text: 'first' }), 'task added');
  assert.equal(goalOf(state, KEY).text, 'Tasks');
});

test('prompt block carries the goal, tasks and the update command', () => {
  const state = {};
  setGoal(state, KEY, 'ship it');
  addTask(state, KEY, 'tests');
  doneTask(state, KEY, 1);
  const block = renderPromptBlock(goalOf(state, KEY), KEY, 'C:\\x\\goal.mjs');
  assert.match(block, /ship it/);
  assert.match(block, /1\. \[x\] tests/);
  assert.match(block, /goal\.mjs" --key "42:7" done <number>/);
  assert.equal(renderPromptBlock(null, KEY, 'x'), '');
});

test('drain applies jobs and moves every file out of the inbox', () => {
  const root = mkdtempSync(join(tmpdir(), 'goals-'));
  const dir = join(root, 'inbox');
  mkdirSync(dir);
  writeFileSync(join(dir, 'a.json'), JSON.stringify({ key: KEY, op: 'set', text: 'goal' }));
  writeFileSync(join(dir, 'b.json'), JSON.stringify({ key: KEY, op: 'add', text: 'task' }));
  writeFileSync(join(dir, 'c.json'), JSON.stringify({ key: KEY, op: 'done', index: 1 }));
  writeFileSync(join(dir, 'bad.json'), '{not json');
  const state = {};
  assert.equal(drainGoalJobs(state, dir, join(root, 'done')), 3);
  assert.equal(readdirSync(dir).length, 0);
  assert.equal(progressOf(goalOf(state, KEY)).done, 1);
});
