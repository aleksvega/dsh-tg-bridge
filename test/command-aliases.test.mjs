// One name per job. A phone keyboard turns `task` into `tasks` without the person
// noticing, so the pair must be the same command — and the second spelling must
// never be advertised, or the confusion comes back through the documentation.
import test from "node:test";
import "./sandbox-home.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMMAND_ALIASES, CONTROL_COMMANDS, DOCUMENTED_COMMANDS, EXTERNAL_COMMANDS } from "../chat/control.mjs";
import { helpLines } from "../chat/help-sections.mjs";
import { LANGS, t } from "../core/i18n.mjs";

const names = (text) => [...new Set([...text.matchAll(/(?:^|[\s([«"—·])\/([a-z][a-z-]{1,20})\b/gm)].map((m) => m[1]))];

/** The /help text as the chat receives it, for one language. */
const helpText = (lang) => helpLines((k, vars) => t(lang, k, vars)).join("\n");

test("every alias points at a command that exists, and is not itself documented", () => {
  for (const [alias, canonical] of Object.entries(COMMAND_ALIASES)) {
    assert.ok(CONTROL_COMMANDS.includes(alias), `${alias} must still be accepted`);
    assert.ok(DOCUMENTED_COMMANDS.includes(canonical), `${canonical} must be a documented command`);
    assert.ok(!DOCUMENTED_COMMANDS.includes(alias), `${alias} is an alias and must not be documented`);
  }
});

test("/help advertises no alias, in any language", () => {
  for (const lang of LANGS) {
    const shown = names(helpText(lang));
    const leaked = shown.filter((name) => COMMAND_ALIASES[name]);
    assert.deepEqual(leaked, [], `${lang}/help teaches these aliases back: ${leaked.join(", ")}`);
  }
});

test("every documented command is in /help and in the accepted list", () => {
  const shown = new Set(LANGS.flatMap((lang) => names(helpText(lang))));
  const silent = DOCUMENTED_COMMANDS.filter((name) => !shown.has(name));
  assert.deepEqual(silent, [], `commands a person cannot discover: ${silent.join(", ")}`);
  const accepted = new Set([...CONTROL_COMMANDS, ...EXTERNAL_COMMANDS]);
const unknown = [...shown].filter((name) => !accepted.has(name));
  assert.deepEqual(unknown, [], `help offers commands the bot would reject: ${unknown.join(", ")}`);
});

test("a renamed command keeps its old spelling as an alias", () => {
  assert.equal(COMMAND_ALIASES.agentset, "crew");
  assert.ok(CONTROL_COMMANDS.includes("crew"));
});

test("the help sentence of a pair names its command only once", () => {
  // A sentence like "… the list is /tasks" teaches the alias back.
  for (const lang of LANGS) {
    for (const canonical of ["tasks", "model", "plugins", "crew"]) {
      const said = t(lang, `ctrl.help.about.${canonical}`);
      assert.ok(said.length > 20, `${lang}/${canonical} has no sentence`);
      const leaked = names(said).filter((name) => COMMAND_ALIASES[name]);
      assert.deepEqual(leaked, [], `${lang}/ctrl.help.about.${canonical} mentions an alias: ${leaked.join(", ")}`);
    }
  }
});
