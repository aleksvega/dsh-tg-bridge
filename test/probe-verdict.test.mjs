// The probe's verdict, checked against answers providers really gave.
//
// The case that forced this file: one router answers a per-minute limit with a
// 403 and the words "at its provider's per minute limit right now". Reading the
// status first made the card say "key refused" — advice that sends a person to
// re-enter a key that works, while the route was merely throttled.
import test from "node:test";
import assert from "node:assert/strict";
import { classify, describeVerdicts } from "../model-probe.mjs";

const LIMIT_403 = '{"error":{"message":"This model is at its provider\'s per minute limit right now. '
  + 'Nothing is wrong with the model itself."}}';
const POOL_503 = '{"error":{"code":"get_channel_failed","message":"All providers for model '
  + '\\"glm-5.3-flash:free\\" are busy right now (they hit their rate limit)."}}';

test("a per-minute limit behind a 403 is a busy route, not a refused key", () => {
  assert.equal(classify(403, LIMIT_403), "busy");
  // The live shape: the router's own sentence, no code field.
  assert.equal(classify(503, POOL_503), "busy");
});

test("a bare 403 or 401 is still a refused key", () => {
  // Without a word about a limit there is nothing to soften: the key is wrong.
  assert.equal(classify(403, '{"error":{"message":"Forbidden"}}'), "auth");
  assert.equal(classify(401, '{"error":{"message":"Invalid API key"}}'), "auth");
});

test("an empty balance outranks everything the status could say", () => {
  assert.equal(classify(403, '{"error":{"code":"insufficient_user_quota"}}'), "balance");
  assert.equal(classify(429, '{"error":{"message":"insufficient balance"}}'), "balance");
});

test("a 5xx with no words of its own is busy, not unknown", () => {
  assert.equal(classify(500, ""), "busy");
  assert.equal(classify(502, "bad gateway"), "busy");
  // And a 4xx the probe has no name for stays "other", which the card prints
  // as "refused" instead of inventing a cause.
  assert.equal(classify(418, '{"error":{"message":"I am a teapot"}}'), "other");
});

test("one throttled route does not make the whole chain busy", () => {
  // describeVerdicts is what the give-up message reads: an auth failure beside a
  // busy one must not be reported as "everything is overloaded".
  assert.equal(describeVerdicts([{ kind: "busy" }, { kind: "auth" }]), "busy");
  assert.equal(describeVerdicts([{ kind: "auth" }, { kind: "missing" }]), "auth");
});
