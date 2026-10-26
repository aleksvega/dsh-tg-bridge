// The search action, end to end, with the registry stubbed: a wordless search is
// allowed, a bad answer is a failure sentence, and every row is a button that
// carries `/plugin add`.
import test from "node:test";
import assert from "node:assert/strict";
import { handleControl } from "../control.mjs";

function context(arg, body, ok = true) {
  const said = [];
  const keyboards = [];
  const reply = (text, extra) => {
    said.push(String(text));
    if (extra && extra.keyboard) keyboards.push(extra.keyboard);
  };
  return {
    said,
    keyboards,
    ctx: {
      command: "/plugins", arg, text: `/plugins ${arg}`.trim(), lang: "en", chatId: 1, threadId: 0, key: "1:0",
      state: { sessions: {}, lang: {} }, config: { profile: "headless", lang: "en" },
      activeTurns: new Map(), saveState: () => {}, log: () => {}, send: reply, reply,
      api: async () => ({}), sendFile: async () => {},
      jobs: () => ({ active: [], queued: 0, max: 2 }), profile: "headless",
      prices: () => "prices", stopTurn: () => false,
      fetch: async () => ({ ok, status: ok ? 200 : 503, json: async () => body }),
    },
  };
}

const payload = {
  objects: [{ package: { name: "dsh-tg-bridge", version: "1.19.1", description: "Telegram bridge", date: "2026-10-26" } }],
};

test("/plugins search lists what the registry returned, with an install button", async () => {
  const { ctx, said, keyboards } = context("search telegram", payload);
  await handleControl(ctx);
  const text = said.join("\n");
  assert.match(text, /dsh-tg-bridge/);
  assert.match(text, /1\.19\.1/);
  assert.equal(keyboards.length, 1, "the list has no buttons");
  const button = keyboards[0].flat()[0];
  assert.equal(button.callback_data, "pl:i:dsh-tg-bridge");
  assert.match(button.text, /\+ dsh-tg-bridge/);
});

test("/plugins find is the same action", async () => {
  const { ctx, said } = context("find telegram", payload);
  await handleControl(ctx);
  assert.match(said.join("\n"), /dsh-tg-bridge/);
});

test("a wordless search still asks the registry", async () => {
  let asked = "";
  const { ctx } = context("search", payload);
  ctx.fetch = async (url) => {
    asked = url;
    return { ok: true, status: 200, json: async () => payload };
  };
  await handleControl(ctx);
  assert.match(decodeURIComponent(asked), /keywords:dsh-plugin/);
});

test("a refused registry is a failure, not an empty list", async () => {
  const { ctx, said } = context("search telegram", {}, false);
  await handleControl(ctx);
  const text = said.join("\n");
  assert.match(text, /503/);
  assert.doesNotMatch(text, /registry has nothing/i, 'a dead registry must not read as an empty result');
});
