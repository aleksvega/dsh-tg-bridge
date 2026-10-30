// A fresh install with no /lang and no config default answers in English, and a
// topic that chose Russian still answers in Russian. This is the rule the help
// and the restart prompt used to break by hardcoding Russian.
import test from "node:test";
import assert from "node:assert/strict";
import "./sandbox-home.mjs";
import { handleControl } from "../chat/control.mjs";
import { resolveLang } from "../core/i18n.mjs";

const cyrillic = /[\u0400-\u04FF]/;

async function answer(command, arg, { lang, configLang, stored } = {}) {
  const said = [];
  const state = { sessions: {}, lang: stored ? { "1:0": stored } : {} };
  const ctx = {
    command, arg, text: `${command} ${arg}`.trim(), lang, chatId: 1, threadId: 0, key: "1:0",
    state, config: { profile: "headless", ...(configLang ? { lang: configLang } : {}) },
    activeTurns: new Map(), saveState: () => {}, log: () => {},
    send: (text) => said.push(String(text)), reply: (text) => said.push(String(text)),
    api: async () => ({}), sendFile: async () => {},
    jobs: () => ({ active: [], queued: 0, max: 2 }), profile: "headless",
    prices: () => "prices", stopTurn: () => false,
  };
  await handleControl(ctx);
  return said.join("\n");
}

test("with no language anywhere, system commands answer in English", async () => {
  for (const command of ["/restart", "/stop", "/new", "/help"]) {
    const text = await answer(command, "");
    assert.ok(text.length > 5, `${command} said nothing`);
    assert.doesNotMatch(text, cyrillic, `${command} fell back to Russian`);
  }
});

test("a topic that chose Russian gets Russian, command or not", async () => {
  // resolveLang reads state.lang and hands the answer on as ctx.lang.
  const key = "1:0";
  const state = { lang: { [key]: "ru" } };
  assert.equal(resolveLang(state, key, null, {}), "ru");
  const text = await answer("/restart", "", { lang: "ru" });
  assert.match(text, cyrillic);
});

test("an explicit ctx.lang beats the stored one, as /lang set it", async () => {
  const ru = await answer("/restart", "", { lang: "ru", stored: "en" });
  assert.match(ru, cyrillic);
  const en = await answer("/restart", "", { lang: "en", configLang: "ru" });
  assert.doesNotMatch(en, cyrillic);
});

test("the config default is used when the topic never chose", async () => {
  const text = await answer("/restart", "", { configLang: "ru" });
  assert.match(text, cyrillic, "a Russian install must not answer its own owner in English");
});
