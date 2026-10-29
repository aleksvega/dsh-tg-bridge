// The chain's rules, as data: which failures start a failover, which ones must
// reach the free tail, and when the person deserves one message instead of
// silence. These lived as three regexes and an if-condition inside a 499-line
// message handler, where only a live incident could check them.
import test from "node:test";
import assert from "node:assert/strict";
import { CHANNEL_DOWN, FALLBACK_TRIGGERS, QUOTA_LIKE, exhausted, labelOf } from "../fallback.mjs";

test("a busy provider and a dead balance both start the chain", () => {
  for (const error of [
    "503 Service Unavailable",
    "get_channel_failed",
    "all providers are busy",
    "RATE_LIMIT exceeded",
    "insufficient_user_quota",
    "AUTH 403",
    "MISSING_CREDENTIAL",
  ]) {
    assert.equal(FALLBACK_TRIGGERS.test(error), true, `${error} must trigger a fallback`);
  }
});

test("a real task failure is not retried on four other vendors", () => {
  // Retrying these would cost a full turn per model and fail identically.
  for (const error of ["context length exceeded", "invalid tool schema", "ENOENT: no such file"]) {
    assert.equal(FALLBACK_TRIGGERS.test(error), false, `${error} is not a provider fault`);
  }
});

test("a dead balance is reported as a balance, not as a busy channel", () => {
  assert.equal(QUOTA_LIKE.test("insufficient_user_quota"), true);
  assert.equal(QUOTA_LIKE.test("403 forbidden"), true);
  // The provider's own pool being down says nothing about the account.
  assert.equal(QUOTA_LIKE.test("get_channel_failed"), false);
});

test("a channel-pool failure is the one that skips ahead instead of retrying", () => {
  assert.equal(CHANNEL_DOWN.test("all providers are busy"), true);
  assert.equal(CHANNEL_DOWN.test("insufficient_user_quota"), false);
});

test("a route is named provider/model so two companies are distinguishable", () => {
  // The same model id on two routers is two different attempts, and the chat
  // must not show them as one.
  assert.equal(labelOf({ provider: "alpha", model: "m" }), "alpha/m");
  assert.equal(labelOf({ model: "m" }), "m", "an unlabelled entry keeps its model name");
  assert.equal(labelOf({}), "");
});

test("the give-up message needs proof: every entry tried, or a verdict", () => {
  assert.equal(exhausted({ tried: ["a", "b", "c"], chainLength: 3 }), true);
  assert.equal(exhausted({ tried: ["a"], chainLength: 3, probeKind: "busy" }), true);
  // Nothing tried and nothing known is not proof of anything.
  assert.equal(exhausted({ tried: [], chainLength: 3, probeKind: "busy" }), false);
  assert.equal(exhausted({ tried: ["a"], chainLength: 3 }), false);
});
