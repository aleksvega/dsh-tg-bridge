// A test that reaches a real profile is a test that can install into it. This
// guard fails loudly instead of letting the next one repeat today's accident.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const FILES = readdirSync("test").filter((name) => name.endsWith(".test.mjs"));

test("no test imports control.mjs without a throwaway DSH_HOME", () => {
  const offenders = [];
  for (const name of FILES) {
    const src = readFileSync(`test/${name}`, "utf8");
    if (name === "profile-sandbox.test.mjs") continue;
    if (!src.includes('from "../chat/control.mjs"') && !src.includes('import("../chat/control.mjs")')) continue;
    const sandboxed = /import "\.\/sandbox-home\.mjs"/.test(src) || /process\.env\.DSH_HOME\s*=/.test(src);
    if (!sandboxed) offenders.push(name);
  }
  assert.deepEqual(offenders, [], `these tests read the machine's real profiles: ${offenders.join(", ")}`);
});
