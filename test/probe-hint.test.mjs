// The two failures from the 741-second turn: a hint that never reached the
// person, and a chain that gave each dead channel a full minute.
import test from "node:test";
import assert from "node:assert/strict";
import { probeHint } from "../model-probe.mjs";

test("the probe hint is a sentence the person can act on", () => {
  for (const kind of ["balance", "busy", "auth", "network"]) {
    const hint = probeHint(kind);
    assert.ok(hint.length > 30, `${kind} hint is too short to say anything: "${hint}"`);
    assert.ok(!/^\[[^\]]*\]$/.test(hint), `${kind} hint is a bare tag`);
  }
  assert.equal(probeHint("unknown"), "");
});

test("the balance hint names the balance, not the first word of a raw error", () => {
  assert.match(probeHint("balance"), /баланс/i);
  assert.match(probeHint("busy"), /503|перегруж/i);
});
