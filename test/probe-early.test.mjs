// The 741-second turn: the provider's channel pool was down for every model.
// The fix is only correct if the person still gets one message that says so —
// stopping the chain early must not mean stopping the report.
import test from "node:test";
import assert from "node:assert/strict";
import { describeVerdicts, probeHint } from "../model-probe.mjs";

/** Mirrors the condition in bridge.mjs that decides to speak up. */
function saysAllDown(tried, probeKind, chainLength) {
  return tried.length > 0 && (probeKind !== "" || tried.length >= chainLength);
}

test("a chain stopped early still reports, because the verdict is the reason", () => {
  // Two of three models were skipped: without a verdict this would be silence.
  assert.equal(saysAllDown(["a", "b"], "busy", 3), true);
  assert.equal(saysAllDown(["a", "b"], "", 3), false, "no verdict and a short chain is not proof");
  // The ordinary case: every model tried.
  assert.equal(saysAllDown(["a", "b", "c"], "", 3), true);
});

test("a verdict with no model tried does not claim anything", () => {
  assert.equal(saysAllDown([], "busy", 3), false);
});

test("busy is the verdict of a 503 storm", () => {
  assert.equal(describeVerdicts([{ kind: "busy" }, { kind: "busy" }]), "busy");
  // "busy" wins over a single network miss: a channel that answered 503 proves
  // the network works, and that is the more specific fact.
  assert.equal(describeVerdicts([{ kind: "busy" }, { kind: "network" }]), "busy");
  assert.equal(describeVerdicts([{ kind: "missing" }]), "unknown");
});

test("the busy hint tells the person it is not their balance", () => {
  const said = probeHint("busy", "ru");
  assert.match(said, /503/);
  assert.match(said, /не баланс/i);
});
