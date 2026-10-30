// The dictionary must not carry a language it is not: English with Russian
// words, Chinese with Latin sentences nobody translated.
import test from "node:test";
import assert from "node:assert/strict";
import { LANGS, keysOf, t } from "../core/i18n.mjs";

const cyrillic = /[\u0400-\u04FF]/;
const han = /[\u4e00-\u9fff]/;

test("an English value carries no Russian", () => {
  const bad = keysOf("en").filter((key) => cyrillic.test(t("en", key)));
  assert.deepEqual(bad, [], `English keys holding Russian: ${bad.join(", ")}`);
});

test("a Chinese value carries no Russian", () => {
  const bad = keysOf("zh").filter((key) => cyrillic.test(t("zh", key)));
  assert.deepEqual(bad, [], `Chinese keys holding Russian: ${bad.join(", ")}`);
});

test("a Chinese value is actually Chinese unless it is a command", () => {
  // `/rewind 2` and `{n}` are the same in every language; a whole sentence in
  // Latin letters is a translation somebody skipped.
  const latinOnly = keysOf("zh").filter((key) => {
    const text = t("zh", key);
    if (han.test(text)) return false;
    const bare = text.replace(/\{\w+\}/g, " ").replace(/[^A-Za-z]+/g, " ").trim();
    return bare.split(/\s+/).filter((word) => word.length >= 3).length >= 2;
  });
  assert.deepEqual(latinOnly, [], `Chinese keys left in English: ${latinOnly.join(", ")}`);
});
