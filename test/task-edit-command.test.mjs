// The command surface: `/task edit 2 new words` rewrites the line, and a bad
// number is a refusal with the same sentence as the other bad numbers.
import test from "node:test";
import assert from "node:assert/strict";
import "./sandbox-home.mjs";
import { handleControl } from "../control.mjs";
import { addTask, goalOf, setGoal } from "../goals.mjs";

function context(arg) {
  const said = [];
  const state = {};
  setGoal(state, "1:0", "Ship it");
  addTask(state, "1:0", "first line");
  addTask(state, "1:0", "second line");
  return {
    said,
    state,
    ctx: {
      command: "/task", arg, text: `/task ${arg}`, lang: "en", chatId: 1, threadId: 0, key: "1:0",
      state, config: { profile: "headless", lang: "en" },
      activeTurns: new Map(), saveState: () => {}, log: () => {},
      send: (text) => said.push(String(text)), reply: (text) => said.push(String(text)),
      api: async () => ({}), sendFile: async () => {},
      jobs: () => ({ active: [], queued: 0, max: 2 }), profile: "headless",
      prices: () => "prices", stopTurn: () => false,
    },
  };
}

test("/task edit rewrites the numbered line", async () => {
  const { ctx, state, said } = context("edit 2 something better");
  await handleControl(ctx);
  assert.equal(goalOf(state, "1:0").tasks[1].text, "something better");
  assert.match(said.join("\n"), /rewritten|2/);
});

test("/task set is the same action", async () => {
  const { ctx, state } = context("set 1 rewritten first");
  await handleControl(ctx);
  assert.equal(goalOf(state, "1:0").tasks[0].text, "rewritten first");
});

test("an impossible edit is refused and changes nothing", async () => {
  const { ctx, state, said } = context("edit 9 nope");
  await handleControl(ctx);
  assert.equal(goalOf(state, "1:0").tasks.length, 2);
  assert.ok(said.length > 0, "a refused edit said nothing");
});
