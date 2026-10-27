// Nothing may throw out of handleControl. The subagent found two ReferenceErrors
// that node --check cannot see and no test called, so this calls every command
// for real, with the smallest context that is still honest.
import test from "node:test";
import "./sandbox-home.mjs";
import assert from "node:assert/strict";
import { CONTROL_COMMANDS, handleControl } from "../control.mjs";

function context(command, arg = "") {
  const said = [];
  const reply = (text) => said.push(String(text));
  return {
    said,
    ctx: {
      command, arg, text: `${command} ${arg}`.trim(), lang: "ru", chatId: 1, threadId: 0, key: "1:0",
      state: { sessions: {}, lang: {} }, config: { profile: "headless", lang: "ru" },
      activeTurns: new Map(), saveState: () => {}, log: () => {}, send: reply, reply,
      api: async () => ({}), sendFile: async () => {},
      jobs: () => ({ active: [], queued: 0, max: 2 }), profile: "headless",
      prices: () => "prices", stopTurn: () => false,
    },
  };
}

test("every command answers without throwing", async () => {
  for (const command of CONTROL_COMMANDS) {
    const { ctx } = context(`/${command}`);
    await assert.doesNotReject(() => handleControl(ctx), `/${command} threw`);
  }
});

test("/help <alias> answers as the command that owns the job", async () => {
  // The pairs used to be explained apart. One letter apart is a mistake a phone
  // keyboard makes for the person, so there is one command and the old spelling
  // is answered with it — the reader never learns a second name.
  const pairs = [["task", "tasks"], ["model", "models"], ["plugins", "plugin"], ["crew", "agentset"]];
  for (const [one, many] of pairs) {
    const first = context("/help", one);
    const second = context("/help", many);
    await handleControl(first.ctx);
    await handleControl(second.ctx);
    const a = first.said.join(" ");
    const b = second.said.join(" ");
    assert.ok(a.length > 20, `/help ${one} said nothing useful`);
    assert.equal(a, b, `/help ${many} told a different story than /help ${one}`);
    assert.ok(!a.includes("list"), `/help ${one} still teaches a second spelling`);
  }
});

test("/help names an unknown command instead of staying silent", async () => {
  const { ctx, said } = context("/help", "nosuchcommand");
  await handleControl(ctx);
  assert.match(said.join(" "), /nosuchcommand/);
  assert.match(said.join(" "), /\/help/);
});

test("/help works in every language", async () => {
  for (const lang of ["en", "ru", "zh"]) {
    const { ctx, said } = context("/help", "rewind");
    ctx.lang = lang;
    ctx.config.lang = lang;
    await handleControl(ctx);
    const text = said.join(" ");
    assert.ok(!text.startsWith("ctrl.help"), `${lang} lacks the explanation`);
    assert.match(text, /rewind/, `${lang} does not name the command`);
  }
});

test("/menu draws a card whose buttons are commands", async () => {
  const { ctx, said } = context("/menu");
  let keyboard = [];
  ctx.reply = (text, extra = {}) => {
    said.push(String(text));
    keyboard = extra.keyboard || [];
  };
  await handleControl(ctx);
  assert.ok(said.length > 0);
  assert.ok(keyboard.length >= 2, "the panel drew no buttons");
  for (const row of keyboard) for (const button of row) assert.match(button.data, /^mn:/);
});
