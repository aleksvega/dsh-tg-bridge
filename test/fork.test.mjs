// A fork is a copy of a session as a session of its own. The dangerous parts are
// the header (a copy that kept the old id would collide with the original) and
// the original file (a fork must not touch it at all).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, utimesSync } from "node:fs";
import { allTurns, applyFork, frameOffsets, planFork } from "../rewind.mjs";
import { writeSession } from "./rewind-fixture.mjs";
import { zstdDecompressSync } from "node:zlib";

const THREE = [
  { user: "one", answer: "A" },
  { user: "two", answer: "B" },
  { user: "three", answer: "C" },
];

const headerOf = (file) => {
  const buf = readFileSync(file);
  const offsets = frameOffsets(buf);
  const first = zstdDecompressSync(buf.subarray(offsets[0], offsets[1])).toString("utf8");
  return JSON.parse(first.split("\n")[0]);
};

test("branching from the end keeps every turn", () => {
  const { file } = writeSession(THREE);
  const plan = planFork(file, 0);
  assert.equal(plan.reason, "");
  assert.equal(plan.kept, 3);
  assert.equal(plan.offset, plan.size);
});

test("branching from n turns back keeps the turns before them", () => {
  const { file } = writeSession(THREE);
  const plan = planFork(file, 2);
  assert.equal(plan.reason, "");
  assert.equal(plan.kept, 1);
  assert.equal(plan.dropped, 2);
  const forked = applyFork(file, plan.offset, plan.size);
  assert.equal(allTurns(forked.file).length, 1);
});

test("the copy is a session of its own, not a second copy of the original id", () => {
  const { file } = writeSession(THREE);
  const before = headerOf(file);
  const plan = planFork(file, 0);
  const forked = applyFork(file, plan.offset, plan.size);
  const after = headerOf(forked.file);
  assert.notEqual(after.id, before.id, "the fork kept the original id");
  assert.match(after.id, /^session-[0-9a-f-]{36}$/);
  assert.equal(after.cwd, before.cwd, "the fork lost the working directory");
  assert.equal(after.version, before.version);
  assert.ok(existsSync(forked.file));
  assert.ok(forked.file.includes(after.id), "the fork is not in a directory named after it");
});

test("the original is untouched by a fork", () => {
  const { file } = writeSession(THREE);
  const snapshot = readFileSync(file);
  const plan = planFork(file, 1);
  applyFork(file, plan.offset, plan.size);
  assert.deepEqual(readFileSync(file), snapshot);
  assert.equal(allTurns(file).length, 3);
});

test("a session written moments ago is not forked", () => {
  const { file } = writeSession(THREE);
  const now = new Date();
  utimesSync(file, now, now);
  assert.equal(planFork(file, 0).reason, "recently-written");
});

test("a fork neither invents turns nor cuts all of them", () => {
  const { file } = writeSession(THREE);
  assert.equal(planFork(file, 9).reason, "too-many-steps");
  assert.equal(planFork(file, -1).reason, "bad-steps");
  const empty = writeSession([]);
  assert.equal(planFork(empty.file, 0).kept, 0);
  assert.equal(planFork(empty.file, 1).reason, "no-turns");
});

test("a fork refuses a file that grew between plan and copy", () => {
  const { file } = writeSession(THREE);
  const plan = planFork(file, 0);
  utimesSync(file, new Date(Date.now() - 600000), new Date(Date.now() - 600000));
  const grown = plan.size + 1;
  assert.throws(() => applyFork(file, plan.offset, grown), /grew/);
});
