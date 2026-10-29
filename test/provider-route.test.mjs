// A chain of models from different companies is only as good as the question
// asked before each attempt. With one router in the chain a single probe
// answered for every model; with several, asking provider A about provider B's
// model reports A's fault for B's route — the live bridge did exactly that at
// 06:14 and stopped a chain while a working provider sat right behind it.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "dsh-provider-"));
process.env.DSH_HOME = home;
const patch = [
  "plugins:",
  "  - id: some-plugin",
  "    config:",
  "      providers:",
  "        alpha:",
  "          api: openai-responses",
  "          baseURL: https://alpha.example/v1/",
  "          apiKeyEnv: ALPHA_KEY",
  "        beta:",
  "          api: openai-completions",
  "          baseURL: https://beta.example/v1",
  "          apiKeyEnv: BETA_KEY",
  "  - id: agent-default-model",
  "    model: x",
].join("\n");
mkdirSync(join(home, "profiles", "headless"), { recursive: true });
writeFileSync(join(home, "profiles", "headless", "cordis.patch.yml"), patch);

const { providerFor, providerRows } = await import("../model-probe.mjs");

test("the providers block splits into rows and stops at the next key", () => {
  const rows = providerRows(patch);
  assert.deepEqual(rows.map((row) => row.id), ["alpha", "beta"]);
  // The row that follows the block is not a provider.
  assert.ok(!rows.some((row) => row.id === "agent-default-model"));
});

test("a named provider gets its own route, not the first one", () => {
  const first = providerFor("");
  const beta = providerFor("beta");
  assert.equal(first.id, "alpha");
  assert.equal(beta.id, "beta");
  assert.equal(beta.baseUrl, "https://beta.example/v1", "trailing slash trimmed, and beta's host");
  assert.equal(beta.keyEnv, "BETA_KEY");
  assert.equal(beta.api, "openai-completions");
  // The whole point: two companies, two hosts. One host for both is the bug.
  assert.notEqual(first.baseUrl, beta.baseUrl);
});

test("an unknown provider is null, never someone else's route", () => {
  // Answering with the first provider here would probe alpha's host and blame
  // beta's model for the result — a verdict about a host never tried.
  assert.equal(providerFor("gamma"), null);
});
