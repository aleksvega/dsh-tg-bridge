// Two facts from the DSH audit are worth enforcing here, because both were
// assumptions before:
//  1. a session the desktop app holds open is being written even when no bridge
//     turn runs, and DSH then throws "stored log shrank below a previously
//     observed prefix" — so a fresh write is a refusal, not a cut;
//  2. the projection cache needs no help: rows past the new end are discarded
//     and refolded. Left alone on purpose.

import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, utimesSync } from "node:fs";
import { allTurns, applyRewind, planRewind } from "../rewind.mjs";
import { writeSession } from "./rewind-fixture.mjs";

const THREE = [
  { user: "one", answer: "A" },
  { user: "two", answer: "B" },
  { user: "three", answer: "C" },
];

test("a session written moments ago is not cut", () => {
  const { file } = writeSession(THREE);
  const now = new Date();
  utimesSync(file, now, now);
  const plan = planRewind(file, 1);
  assert.equal(plan.reason, "recently-written");
  assert.equal(allTurns(file).length, 3, "nothing may be removed");
});

test("a session idle for a while is cut", () => {
  const { file } = writeSession(THREE);
  const old = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(file, old, old);
  const plan = planRewind(file, 1);
  assert.equal(plan.reason, "");
  assert.ok(plan.offset > 0);
});

test("the size check still catches a file that grew between plan and cut", () => {
  const { file } = writeSession(THREE);
  const plan = planRewind(file, 1);
  appendFileSync(file, "x");
  assert.throws(() => applyRewind(file, plan.offset, plan.size), /grew/);
  // The cut is all-or-nothing: a refusal leaves the file exactly as it was.
  assert.match(readFileSync(file, "utf8").slice(-1), /x/);
});
