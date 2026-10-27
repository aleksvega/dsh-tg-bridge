// The language is not a decoration: an English or Chinese chat must contain no
// Russian sentence, in the panel, the cards, the help or the answers. This walks
// the surface a person actually sees, in each of the three languages.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LANGS, keysOf, t } from "../i18n.mjs";
import { MENU_GROUPS, renderPanel } from "../menu-card.mjs";
import { renderSettingsCard } from "../settings-card.mjs";
import "./sandbox-home.mjs";
import { handleControl } from "../control.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cyrillic = /[\u0400-\u04FF]/;
const known = new Set(keysOf("ru"));

test("every module asks for keys that exist in every language", () => {
  // The bridge alone was checked before; a key that only exists in Russian leaks
  // a Russian sentence into an English chat, whichever module asked for it.
  const modules = readdirSync(ROOT).filter((name) => name.endsWith(".mjs"));
  const missing = [];
  for (const name of modules) {
    const source = readFileSync(join(ROOT, name), "utf8");
    for (const match of source.matchAll(/\bt\(\s*[^,]+,\s*'([^']+)'/g)) {
      if (!known.has(match[1])) missing.push(`${name}: ${match[1]}`);
    }
  }
  assert.deepEqual(missing, [], `unknown keys: ${missing.join(", ")}`);
});

test("the panel speaks the language of the topic, and only that one", () => {
  for (const lang of LANGS) {
    const cards = [renderPanel({ t: (k, v) => t(lang, k, v) }), ...MENU_GROUPS.map((page) => renderPanel({ t: (k, v) => t(lang, k, v), page }))];
    for (const card of cards) {
      assert.ok(!card.text.startsWith("ctrl.menu"), `${lang} shows a raw key`);
      if (lang === "en" || lang === "zh") assert.doesNotMatch(card.text, cyrillic, `${lang} panel text is Russian`);
      if (lang === "zh") assert.match(card.text, /[\u4e00-\u9fff]/, "zh panel text has no Chinese");
    }
  }
});

test("the settings card speaks the language of the topic", () => {
  const state = { lang: {} };
  for (const lang of LANGS) {
    const card = renderSettingsCard({ t: (k, v) => t(lang, k, v), lang, state, key: "1:0" });
    const text = String(card?.text || "");
    assert.ok(text.length > 20, `${lang} settings card is empty`);
    assert.ok(!text.startsWith("ctrl."), `${lang} settings card shows a raw key`);
    if (lang !== "ru") assert.doesNotMatch(text, cyrillic, `${lang} settings card is Russian`);
  }
});

test("the answers a person asks for come back in their language", async () => {
  const commands = ["/status", "/help", "/menu", "/settings", "/prices", "/doctor"];
  for (const lang of LANGS) {
    for (const command of commands) {
      const said = [];
      const ctx = {
        command, arg: "", text: command, lang, chatId: 1, threadId: 0, key: "1:0",
        state: { sessions: {}, lang: {} }, config: { profile: "headless", lang },
        activeTurns: new Map(), saveState: () => {}, log: () => {}, send: (s) => said.push(String(s)),
        reply: (s) => said.push(String(s)), api: async () => ({}), sendFile: async () => {},
        jobs: () => ({ active: [], queued: 0, max: 2 }), profile: "headless",
        prices: () => "model · in · out · cache\nflash · 0.1 · 0.2 · 0.02", stopTurn: () => false,
      };
      await handleControl(ctx);
      const text = said.join("\n");
      assert.ok(text.length > 10, `${command} in ${lang} said nothing`);
      assert.ok(!/\bctrl\.[a-z]/i.test(text), `${command} in ${lang} shows a raw key`);
      if (lang !== "ru") assert.doesNotMatch(text, cyrillic, `${command} in ${lang} answered in Russian`);
    }
  }
});
