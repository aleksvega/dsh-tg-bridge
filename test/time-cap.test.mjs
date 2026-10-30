// A turn stopped by the clock must not read as a failure: the advice "repeat the
// request" makes the person redo finished work, and the session is on disk.
import test from "node:test";
import assert from "node:assert/strict";
import { t } from "../core/i18n.mjs";
import { explainFailure } from "../turn/failures.mjs";

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

test("a provider refusing the request is named as a refusal, not a balance", () => {
  const live = 'dsh: INVALID_REQUEST: wikivibe API error (400): '
    + '{"code":"invalid_request_error","message":"WikiVibe could not accept these request parameters."}';
  const said = explainFailure(live, "ru");
  assert.match(said, /PROVIDER_REJECT/, "a 400 was reported as an unknown failure");
  assert.doesNotMatch(said, /INSUFFICIENT_QUOTA/, "a 400 is not a dead balance");
  assert.match(said, /\/new/, "the advice is about the conversation, not about waiting");
});

test("load and rate have their own sentence, not the refusal one", () => {
  // A 429 or a 5xx is "come back later", never "this conversation is wrong":
  // sending a person to /new for a busy provider throws their session away.
  const rate = explainFailure("HTTP 429 too many requests", "en");
  assert.match(rate, /RATE_LIMITED/);
  assert.doesNotMatch(rate, /PROVIDER_REJECT/);
  const busy = explainFailure("API error (503): service unavailable", "en");
  assert.doesNotMatch(busy, /PROVIDER_REJECT/, "a 503 is not a refusal");
});
