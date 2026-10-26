// A turn stopped by the clock must not read as a failure: the advice "repeat the
// request" makes the person redo finished work, and the session is on disk.
import test from "node:test";
import assert from "node:assert/strict";
import { t } from "../i18n.mjs";
import { explainFailure } from "../failures.mjs";

const capLines = [
  "turn exceeded 75 min",
  "turn hard cap 75min for 42:7; aborting",
];

test("a turn stopped by the clock explains the clock, in the reader's language", () => {
  for (const line of capLines) {
    const said = explainFailure(line, "ru");
    assert.match(said, /TURN_TIME_CAP/, `${line} was reported as an unknown failure`);
    assert.match(said, /сессия сохранена/, "the person is not told the work survived");
    assert.match(said, /75/, "the message does not say which ceiling was hit");
    assert.doesNotMatch(said, /повтори запрос|TURN_FAILED/);
  }
  assert.match(explainFailure("turn exceeded 12 min", "en"), /Continue/);
  assert.match(explainFailure("turn exceeded 12 min", "zh"), /继续/);
});

test("other failures keep their own causes", () => {
  assert.match(explainFailure("insufficient_user_quota", "ru"), /INSUFFICIENT_QUOTA/);
  assert.match(explainFailure("fetch failed", "ru"), /NETWORK/);
  assert.match(explainFailure("something odd", "ru"), /TURN_FAILED/);
});
