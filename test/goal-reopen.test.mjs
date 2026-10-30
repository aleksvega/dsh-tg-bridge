// A closed goal survives a re-wording, and /goal reopen is the only way back.
import test from "node:test";
import assert from "node:assert/strict";
import "./sandbox-home.mjs";
import { handleControl } from "../chat/control.mjs";
import { addTask, finishGoal, goalOf, reopenGoal, setGoal } from "../work/goals.mjs";

function context(arg) {
  const said = [];
  const state = {};
  setGoal(state, "1:0", "Ship it");
  addTask(state, "1:0", "line one");
  return {
    said,
    state,
    ctx: {
      command: "/goal", arg, text: `/goal ${arg}`, lang: "en", chatId: 1, threadId: 0, key: "1:0",
      state, config: { profile: "headless", lang: "en" },
      activeTurns: new Map(), saveState: () => {}, log: () => {},
      send: (text) => said.push(String(text)), reply: (text) => said.push(String(text)),
      api: async () => ({}), sendFile: async () => {},
      jobs: () => ({ active: [], queued: 0, max: 2 }), profile: "headless",
      prices: () => "prices", stopTurn: () => false,
    },
  };
}

test("re-wording a closed goal keeps it closed, and says so", async () => {
  const { ctx, state, said } = context("ship it properly");
  finishGoal(state, "1:0");
  await handleControl(ctx);
  assert.equal(goalOf(state, "1:0").done, true, "an edit reopened the goal by itself");
  assert.match(said.join("\n"), /still closed/);
  assert.equal(goalOf(state, "1:0").tasks.length, 1, "the checklist was lost");
});

test("/goal reopen opens it again", async () => {
  const { ctx, state, said } = context("reopen");
  finishGoal(state, "1:0");
  await handleControl(ctx);
  assert.equal(goalOf(state, "1:0").done, false);
  assert.match(said.join("\n"), /reopened/i);
});

test("reopening an open goal is refused, not silently accepted", async () => {
  const { ctx, said } = context("reopen");
  await handleControl(ctx);
  assert.match(said.join("\n"), /Nothing to reopen/);
});

test("the module itself refuses to reopen what is not closed", () => {
  const state = {};
  setGoal(state, "1:0", "x");
  assert.equal(reopenGoal(state, "1:0"), null);
  finishGoal(state, "1:0");
  assert.equal(reopenGoal(state, "1:0").done, false);
});
