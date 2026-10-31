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

test("a refused key is a key problem, and a spent balance is a balance problem", () => {
  // Money first: the same line can carry a 403 and the words "allowance used
  // up". Only one of the two sentences tells the person what to do next, and
  // topping up an account whose key is simply wrong fixes nothing.
  const spent = 'dsh: AUTH: router API error (403): {"message":"Your subscription allowance for this period is used up"}';
  const said = explainFailure(spent, "ru");
  assert.match(said, /INSUFFICIENT_QUOTA/, "a spent allowance must offer a top-up");
  assert.doesNotMatch(said, /INVALID_KEY/, "a spent allowance is not a bad key");
  // A bare 401 with nothing about money is the key itself.
  const badKey = explainFailure("AUTH: 401 unauthorized", "en");
  assert.match(badKey, /INVALID_KEY/);
  assert.doesNotMatch(badKey, /INSUFFICIENT_QUOTA/, "a bad key is not an empty account");
  // And a missing key is still its own case, not "the key you have is wrong".
  const missing = explainFailure("MISSING_CREDENTIAL", "en");
  assert.match(missing, /MISSING_CREDENTIAL/);
  assert.doesNotMatch(missing, /INVALID_KEY/);
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

test("a prompt past the window is explained as a window, not as a balance", () => {
  // The owner's own failure line. It used to fall through every case and reach
  // the person as the raw CLI string under TURN_FAILED, while the one piece of
  // advice that helps — the conversation is too long — was nowhere in it.
  const live = "dsh: CONTEXT_WINDOW_EXCEEDED: 400: {\"message\":\"This model's maximum context "
    + "length is 131072 tokens, however you requested about 485000 tokens\"}";
  const said = explainFailure(live, "ru");
  assert.match(said, /CONTEXT_OVERFLOW/, "a window overflow must be named as one");
  assert.doesNotMatch(said, /INSUFFICIENT_QUOTA/, "topping up a balance does not widen a window");
  assert.doesNotMatch(said, /TURN_FAILED/, "the generic line must not shadow a known cause");
  assert.match(said, /\/new/, "the advice must offer a way out");
  // And it is the first case, so no other rule can claim the line instead.
  assert.match(explainFailure("context length exceeded", "en"), /CONTEXT_OVERFLOW/);
});
