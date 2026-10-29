// The chain's rules, as data: which failures start a failover, which ones must
// reach the free tail, and when the person deserves one message instead of
// silence. These lived as three regexes and an if-condition inside a 499-line
// message handler, where only a live incident could check them.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHANNEL_DOWN, FALLBACK_TRIGGERS, QUOTA_LIKE, REFUSAL_BUDGET, ROUTE_REJECTS,
  exhausted, failureFamily, labelOf, liveChain,
} from "../fallback.mjs";

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

test("a route that refuses the request starts the chain too", () => {
  // The live incident this guards: a 400 from one company ended the turn while
  // six other routes sat unused, because the trigger list knew only 5xx and
  // quota words. The person read "the fallback chain never fires".
  const live = 'dsh: INVALID_REQUEST: wikivibe API error (400): '
    + '{"code":"invalid_request_error","message":"WikiVibe could not accept these request parameters."}';
  assert.equal(ROUTE_REJECTS.test(live), true);
  assert.equal(FALLBACK_TRIGGERS.test(live), true, "a 400 must not end the chain");
  for (const error of [
    "API error (400): bad request",
    "API error (422): unprocessable",
    "HTTP 429 too many requests",
    "Bad Request: tool schema rejected",
  ]) {
    assert.equal(FALLBACK_TRIGGERS.test(error), true, `${error} is a route refusal`);
  }
  // A refusal is not a balance problem: the advice differs.
  assert.equal(QUOTA_LIKE.test(live), false, "a 400 is not a dead balance");
  // A 500 is a route failure too, but not a refusal: it is load, and the refusal
  // budget must not be spent on it.
  assert.equal(FALLBACK_TRIGGERS.test("API error (500)"), true);
  assert.equal(ROUTE_REJECTS.test("API error (500)"), false);
  assert.equal(failureFamily("API error (500)"), "busy");
});

test("a real task failure is not retried on four other vendors", () => {
  // Retrying these would cost a full turn per model and fail identically.
  for (const error of ["context length exceeded", "invalid tool schema", "ENOENT: no such file"]) {
    assert.equal(FALLBACK_TRIGGERS.test(error), false, `${error} is not a provider fault`);
  }
});

test("a dead balance is reported as a balance, not as a busy channel", () => {
  assert.equal(QUOTA_LIKE.test("insufficient_user_quota"), true);
  assert.equal(QUOTA_LIKE.test("402 payment required"), true);
  // A bare 403 is a refused key, not an empty account: topping up would not help,
  // and the advice a person gets must match the cause.
  assert.equal(QUOTA_LIKE.test("403 forbidden"), false);
  assert.equal(failureFamily("403 forbidden"), "auth");
  assert.equal(failureFamily("insufficient_user_quota"), "quota");
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

test("every family of provider failure is named, and the order decides", () => {
  // A message can name several things; the first family that claims it decides
  // how the chat explains the switch. A 400 must win over the quota words it may
  // carry, or a refusal would be reported as a dead balance.
  assert.equal(failureFamily("dsh: INVALID_REQUEST: wikivibe API error (400)"), "refused");
  assert.equal(failureFamily("insufficient_user_quota"), "quota");
  assert.equal(failureFamily("AUTH 403"), "auth");
  assert.equal(failureFamily("get_channel_failed"), "busy");
  assert.equal(failureFamily("HTTP 429 too many requests"), "rate");
  assert.equal(failureFamily("read ECONNRESET"), "transport");
  assert.equal(failureFamily("UNKNOWN_MODEL"), "model");
  assert.equal(failureFamily("EMPTY_RESPONSE"), "empty");
  // Not a route's fault: no family, so the walk never starts.
  assert.equal(failureFamily("turn exceeded the hard cap"), "");
  assert.equal(failureFamily("terminated by user"), "");
  assert.equal(failureFamily("spawn dsh ENOENT"), "");
  assert.equal(failureFamily(""), "");
  assert.equal(failureFamily(null), "");
});

test("a refusal has a budget; a busy route does not", () => {
  // One other route answers "is it this vendor or this prompt". The whole chain
  // would answer it by replaying the same long conversation seven times.
  assert.equal(REFUSAL_BUDGET, 1);
});

test("the chain a turn will try is the one the card counts", () => {
  const dir = mkdtempSync(join(tmpdir(), "fb-chain-"));
  const file = (name) => {
    const path = join(dir, name);
    writeFileSync(path, "- id: agent-default-model\n", "utf8");
    return path;
  };
  const chain = [
    { provider: "a", model: "m", patch: file("one.yml") },
    { provider: "b", model: "n", patch: file("two.yml"), off: true },
    { provider: "c", model: "o", patch: join(dir, "gone.yml") },
    { provider: "d", model: "p" },
    null,
  ];
  const live = liveChain(chain);
  assert.equal(live.length, 1, "only a switched-on entry with a readable overlay is a route");
  assert.equal(labelOf(live[0]), "a/m");
  // A garbage value from a hand-edited config is an empty chain, not a crash.
  assert.deepEqual(liveChain(null), []);
  assert.deepEqual(liveChain("nope"), []);
});
