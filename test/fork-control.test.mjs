// /fork must move the topic onto a copy and leave the original alone; /branches
// must offer those copies back. The file work lives in rewind.mjs and is tested
// there — here the subject is what the person is told and what the topic is on.
import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allTurns } from "../rewind.mjs";
import { writeSession } from "./rewind-fixture.mjs";

const HOME = mkdtempSync(join(tmpdir(), "dsh-bridge-fork-"));
const PROJECT = "c-Users-test-project";
const SESSION = "session-test";
const SESSIONS = join(HOME, "sessions");
mkdirSync(join(SESSIONS, PROJECT, SESSION), { recursive: true });

const THREE = [
  { user: "one", answer: "A" },
  { user: "two", answer: "B" },
  { user: "three", answer: "C" },
];

// A session where the app would put it, backdated so the freshness guard lets it
// through: the guard itself has its own test.
const fixture = writeSession(THREE);
const file = join(SESSIONS, PROJECT, SESSION, "session.v4.jsonl.zstd");
copyFileSync(fixture.file, file);
const old = new Date(Date.now() - 10 * 60 * 1000);
utimesSync(file, old, old);

process.env.DSH_HOME = HOME;
const { handleControl } = await import("../control.mjs");

function context(overrides = {}) {
  const out = [];
  const cards = [];
  const ctx = {
    command: "/fork",
    arg: "",
    chatId: 42,
    threadId: 7,
    key: "42:7",
    state: { sessions: { "42:7": SESSION }, profiles: {}, lang: {}, titles: {}, reminders: [] },
    config: { profile: "test" },
    profile: "test",
    lang: "ru",
    activeTurns: new Map(),
    saveState: () => {},
    log: () => {},
    send: async () => {},
    reply: (text, extra) => { out.push(text); cards.push(extra || {}); return 1; },
    sendFile: async () => {},
    stopTurn: () => false,
    seedTopic: async () => {},
    jobs: () => ({ active: [], queued: 0, max: 3 }),
    ...overrides,
  };
  return { ctx, out, cards };
}

const run = async (command, arg = "", overrides = {}) => {
  const built = context({ command, arg, ...overrides });
  await handleControl(built.ctx);
  return { ...built, text: built.out.join("\n") };
};

test("/fork with no session starts one rather than branching nothing", async () => {
  const { text } = await run("/fork", "", { state: { sessions: {}, profiles: {}, lang: {}, titles: {}, reminders: [] } });
  assert.match(text, /нет сессии|no session/);
});

test("/fork refuses while a turn is running", async () => {
  const state = { sessions: { "42:7": SESSION }, profiles: {}, lang: {}, titles: {}, reminders: [] };
  const { text } = await run("/fork", "", { state, activeTurns: new Map([["42:7", { startedAt: Date.now() }]]) });
  assert.match(text, /идёт ход|turn is running/);
  assert.equal(state.sessions["42:7"], SESSION, "a busy topic must not be branched");
});

test("/fork with a word instead of a number explains the form", async () => {
  const { text } = await run("/fork", "later");
  assert.match(text, /\/fork 2|Usage|Как это работает/);
});

test("/fork moves the topic onto a copy and leaves the original untouched", async () => {
  const before = readFileSync(file);
  const state = { sessions: { "42:7": SESSION }, profiles: {}, lang: {}, titles: {}, reminders: [] };
  const { text } = await run("/fork", "", { state });
  const made = state.sessions["42:7"];
  assert.match(made, /^session-[0-9a-f-]{36}$/);
  assert.notEqual(made, SESSION);
  assert.match(text, new RegExp(made.slice(8, 16)));
  assert.deepEqual(readFileSync(file), before, "the branched session was modified");
  const copy = join(SESSIONS, PROJECT, made, "session.v4.jsonl.zstd");
  assert.ok(existsSync(copy), "no session file for the branch");
  assert.equal(allTurns(copy).length, 3, "the branch lost turns");
  assert.equal(state.forks["42:7"].length, 1, "the branch was not remembered");
  assert.equal(state.forks["42:7"][0].from, SESSION);
});

test("/fork 2 branches from two turns back, not from the end", async () => {
  const state = { sessions: { "42:7": SESSION }, profiles: {}, lang: {}, titles: {}, reminders: [] };
  const { text } = await run("/fork", "2", { state });
  const made = state.sessions["42:7"];
  assert.match(text, /1/);
  assert.equal(allTurns(join(SESSIONS, PROJECT, made, "session.v4.jsonl.zstd")).length, 1, "the cut point was ignored");
});

test("/branches lists what /fork made and marks the one in use", async () => {
  const state = { sessions: { "42:7": SESSION }, profiles: {}, lang: {}, titles: {}, reminders: [] };
  const made = (await run("/fork", "", { state })).ctx.state.sessions["42:7"];
  const list = await run("/branches", "", { state });
  assert.match(list.text, /ветк|branch/i);
  const buttons = (list.cards.at(-1).keyboard || []).flat();
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].data, `fk:${made}`, "the button does not name the branch");
  assert.match(buttons[0].text, /•/, "the branch in use is not marked");
});

test("/branches on a topic with no forks says how to make one", async () => {
  const { text, cards } = await run("/branches");
  assert.match(text, /нет веток|No branches/);
  assert.equal(cards.length, 1, "nothing to press, so no card");
});
