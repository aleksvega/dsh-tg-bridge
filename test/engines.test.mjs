// The engine floor is a fact about the code, so it gets a test: a module that
// imports a newer API must be matched by package.json, or npm installs a package
// that dies on the first turn.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
// Every module in the checkout, not just the ones at the root: the zstd reader
// sits in `work/` now, and a root-only scan would pass by seeing nothing.
const modules = (function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (["node_modules", ".git", "test", "openspec", "docs", "tools"].includes(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith(".mjs")) out.push(path);
  }
  return out;
})(".");

test("a zstd import means the package may not claim an older Node", () => {
  const users = modules.filter((name) => readFileSync(name, "utf8").includes("zstdDecompressSync"));
  assert.ok(users.length > 0, "no module reads session frames any more — update this test");
  const floor = Number((/=(\d+)/.exec(pkg.engines.node) || [])[1]);
  assert.ok(floor >= 24, `node:zlib has no zstd before 24, but engines says ${pkg.engines.node}`);
});

test("the CI matrix runs a Node the engines allow", () => {
  const workflow = readFileSync(".github/workflows/test.yml", "utf8");
  const versions = (/"node":\s*\[([^\]]+)\]/ .exec(workflow) || /node:\s*\[([^\]]+)\]/.exec(workflow) || [])[1] || "";
  const listed = versions.split(",").map((part) => Number(part.trim())).filter(Boolean);
  assert.ok(listed.length > 0, "the matrix has no Node versions");
  const floor = Number((/=(\d+)/.exec(pkg.engines.node) || [])[1]);
  for (const version of listed) {
    assert.ok(version >= floor, `CI runs Node ${version}, below the declared floor ${floor}`);
  }
});
