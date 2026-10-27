// The two plugin cards the desktop had and the chat did not: what a package is,
// and whether the installed ones are current.
import test from "node:test";
import assert from "node:assert/strict";
import "./sandbox-home.mjs";

const { handleControl } = await import("../control.mjs");

function context(arg, handler) {
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
      fetch: handler,
    },
  };
}

const manifest = {
  name: "@acme/dsh-git", version: "2.1.0", description: "Git helpers for DSH turns",
  license: "MIT", repository: { url: "git+https://github.com/acme/dsh-git.git" },
  keywords: ["dsh-plugin", "git"], dsh: { bundle: true }, engines: { dsh: ">=0.2.2" },
};

test("/plugins info describes a package before anyone installs it", async () => {
  const { ctx, said } = context("info @acme/dsh-git", async () => ({ ok: true, status: 200, json: async () => manifest }));
  await handleControl(ctx);
  const text = said.join("\n");
  assert.match(text, /@acme\/dsh-git 2\.1\.0/);
  assert.match(text, /Git helpers/);
  assert.match(text, /MIT/);
  assert.match(text, /github\.com\/acme\/dsh-git/);
  assert.match(text, /dsh\.bundle/, "the card must say whether DSH will load it");
  assert.match(text, /Not installed/);
});

test("/plugins info offers the install button only while it is missing", async () => {
  const { ctx, keyboards } = context("info @acme/dsh-git", async () => ({ ok: true, status: 200, json: async () => manifest }));
  await handleControl(ctx);
  assert.equal(keyboards.length, 1);
  assert.equal(keyboards[0].flat()[0].callback_data, "pl:i:@acme/dsh-git");
});

test("a package that is not a DSH plugin is said out loud", async () => {
  const plain = { name: "left-pad", version: "1.0.0", description: "padding" };
  const { ctx, said } = context("info left-pad", async () => ({ ok: true, status: 200, json: async () => plain }));
  await handleControl(ctx);
  assert.match(said.join("\n"), /No dsh\.bundle/);
});

test("a missing package is a missing package, not a broken registry", async () => {
  const { ctx, said } = context("info nope", async () => ({ ok: false, status: 404, json: async () => ({}) }));
  await handleControl(ctx);
  assert.match(said.join("\n"), /no package called nope/);
});

test("a refused registry is reported with its status", async () => {
  const { ctx, said } = context("info thing", async () => ({ ok: false, status: 503, json: async () => ({}) }));
  await handleControl(ctx);
  assert.match(said.join("\n"), /503/);
});

test("/plugins update never installs without a name", async () => {
  // This test used to walk the real desktop profile and start a pnpm run per
  // plugin — it upgraded 14 packages on this machine. A wordless call must only
  // report; the only thing it may touch is the registry.
  let fetched = 0;
  const { ctx, said, keyboards } = context("update", async () => {
    fetched += 1;
    return { ok: true, status: 200, json: async () => manifest };
  });
  await handleControl(ctx);
  const text = said.join("\n");
  assert.ok(fetched > 0 || /current|нечего/i.test(text));
  assert.doesNotMatch(text, /installed\.$/, "a wordless update must not install");
  assert.ok(keyboards.length <= 1);
});
