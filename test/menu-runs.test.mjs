// The panel and the commands meet in one place: `commandForName` turns a button
// into text the bridge types on the person's behalf. That text has to run
// through the real handleControl without throwing, and it has to say something:
// a press that answers with silence looks like a dead bot.
import test from "node:test";
import "./sandbox-home.mjs";
import assert from "node:assert/strict";
import { CONTROL_COMMANDS, handleControl } from "../chat/control.mjs";
import { commandForName, menuCommands, runsUnasked } from "../chat/menu-card.mjs";
import { t } from "../core/i18n.mjs";

const tr = (lang) => (key, vars) => t(lang, key, vars);

/** The text a press really produces, exactly as bridge.mjs builds it. */
function pressText(name) {
  // Commands are typed with the leading slash; `commandForName` returns it, but
  // a bare name would parse as an empty command here and look silent.
  if (!runsUnasked(name) || !CONTROL_COMMANDS.includes(name)) return `/help ${name}`;
  const typed = commandForName(name, { t: tr('ru') });
  return typed.startsWith('/') ? typed : `/${typed}`;
}

function context(text) {
  // The dispatcher splits on its own; this only needs the two fields it reads.
  const [command = '', ...rest] = text.trim().split(' ');
  const said = [];
  // handleControl talks through `reply`; `send` stays separate so a command that
  // writes a file or a card is visible here too.
  const reply = (value) => said.push(String(value));
  return {
    said,
    ctx: {
      command, arg: rest.join(" "), text, lang: "ru", chatId: 1, threadId: 0, key: "1:0",
      state: { sessions: {}, lang: {} }, config: { profile: "headless", lang: "ru" },
      activeTurns: new Map(), saveState: () => {}, log: () => {}, send: reply, reply,
      api: async () => ({}), sendFile: async () => {},
      jobs: () => ({ active: [], queued: 0, max: 2 }), profile: "headless",
      prices: () => "prices", stopTurn: () => false,
    },
  };
}

test("every press on the panel answers without throwing", async () => {
  for (const name of menuCommands()) {
    const { ctx } = context(pressText(name));
    await assert.doesNotReject(() => handleControl(ctx), `a press on ${name} threw`);
  }
});

test("every press answers with words, not with silence", async () => {
  for (const name of menuCommands()) {
    const { ctx, said } = context(pressText(name));
    await handleControl(ctx);
    assert.ok(said.length > 0, `a press on ${name} said nothing`);
    assert.ok(said.every((line) => line.trim().length > 0), `a press on ${name} said an empty line`);
  }
});

test("a press never runs /new or /stop", () => {
  assert.equal(pressText("new"), "/help new");
  assert.equal(pressText("stop"), "/help stop");
  assert.equal(pressText("status"), "/status");
  // /rewind run bare opens its own card, which is the useful answer; an
  // explanation page is not.
  assert.equal(pressText("rewind"), "/rewind");
  assert.equal(pressText("model"), "/model");
});
