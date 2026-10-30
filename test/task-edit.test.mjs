// A checklist a person can edit, the way the desktop lets them: the number stays
// put, the words change, and a closed line stays closed.
import test from "node:test";
import assert from "node:assert/strict";
import { addTask, editTask, goalOf, progressOf, removeTask, setGoal, doneTask } from "../work/goals.mjs";

const fresh = () => {
  const state = {};
  setGoal(state, "1:0", "Ship 1.19.2");
  return state;
};

test("an edited task keeps its number and its state", () => {
  const state = fresh();
  addTask(state, "1:0", "first");
  addTask(state, "1:0", "second");
  doneTask(state, "1:0", 1);
  assert.equal(editTask(state, "1:0", 2, "second, reworded"), true);
  const goal = goalOf(state, "1:0");
  assert.equal(goal.tasks.length, 2, "an edit must not add a line");
  assert.equal(goal.tasks[1].text, "second, reworded");
  assert.equal(goal.tasks[0].done, true, "the edit touched the wrong line");
  assert.equal(goal.tasks[1].done, false);
  assert.deepEqual(progressOf(goal), { total: 2, done: 1 });
});

test("an edit that cannot land says so instead of inventing a line", () => {
  const state = fresh();
  addTask(state, "1:0", "only");
  assert.equal(editTask(state, "1:0", 5, "nowhere"), false);
  assert.equal(editTask(state, "1:0", 0, "zero"), false);
  assert.equal(editTask(state, "1:0", 1, "   "), false, "an empty edit would erase the line");
  assert.equal(goalOf(state, "1:0").tasks[0].text, "only");
  const empty = {};
  assert.equal(editTask(empty, "9:9", 1, "no goal"), false);
  removeTask(state, "1:0", 1);
  assert.equal(goalOf(state, "1:0").tasks.length, 0);
});
