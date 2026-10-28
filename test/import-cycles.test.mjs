// No import cycles among the shipped modules.
//
// Node does not report a cycle: the module that closes the loop finishes early
// with `undefined` where a function should be, and the failure surfaces three
// frames away as "undefined is not a function". During the split in
// `openspec/changes/split-giant-files` that is the likeliest way to break the
// bridge, so it gets its own test rather than a paragraph in the design.
import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { shippedModules } from './module-size.test.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Relative imports of one module, resolved to repo-relative paths. */
function edges(rel) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  const out = [];
  for (const match of text.matchAll(/from\s+'(\.[^']*)'/g)) {
    const target = normalize(join(dirname(rel), match[1])).split('\\').join('/');
    out.push(target.endsWith('.mjs') || target.endsWith('.js') ? target : `${target}.mjs`);
  }
  return out;
}

/** The graph restricted to shipped modules, so a dev-only file cannot close a loop. */
function graph() {
  const shipped = new Set(shippedModules());
  const out = new Map();
  for (const rel of shipped) {
    out.set(rel, edges(rel).filter((target) => shipped.has(target)));
  }
  return out;
}

test('the shipped module graph is acyclic', () => {
  const g = graph();
  const state = new Map();
  const stack = [];
  const cycles = [];

  const visit = (node) => {
    if (state.get(node) === 'done') return;
    if (state.get(node) === 'open') {
      const from = stack.indexOf(node);
      cycles.push([...stack.slice(from), node].join(' -> '));
      return;
    }
    state.set(node, 'open');
    stack.push(node);
    for (const next of g.get(node) || []) visit(next);
    stack.pop();
    state.set(node, 'done');
  };

  for (const node of g.keys()) visit(node);
  assert.deepEqual(cycles, [], `import cycle(s): ${cycles.join(' | ')}`);
});

test('every relative import in a shipped module resolves to a shipped module', () => {
  const shipped = new Set(shippedModules());
  const missing = [];
  for (const rel of shipped) {
    for (const target of edges(rel)) {
      if (!shipped.has(target)) missing.push(`${rel} -> ${target}`);
    }
  }
  assert.deepEqual(missing, [], `a shipped module imports something the tarball does not carry: ${missing.join(', ')}`);
});
