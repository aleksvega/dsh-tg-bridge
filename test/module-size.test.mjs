// A ceiling on module size, enforced instead of promised.
//
// The two shipped faults of 1.19.x (an `/update confirm` that wrote nothing, an
// allowlist one branch skipped) both lived in files nobody could read in one
// sitting. A rule in a document does not stop that from happening again; a test
// that fails the build does.
//
// `MIGRATION` is the progress bar: every refactoring step deletes its own entry,
// no step adds one, and the second test fails if an entry stops being true — a
// stale entry would let a file grow back past the ceiling unnoticed.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIMIT = 500;

const MIGRATION = new Set([
  'bridge.mjs',
  'i18n/en.mjs',
  'i18n/ru.mjs',
  'i18n/zh.mjs',
]);

/** Every shipped module: `files[]`, with the declared directories expanded. */
export function shippedModules(root = ROOT) {
  const listed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).files || [];
  const out = [];
  const walk = (rel) => {
    const abs = join(root, rel);
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs)) walk(join(rel, name));
      return;
    }
    if (rel.endsWith('.mjs') || rel.endsWith('.js')) out.push(rel.split('\\').join('/'));
  };
  for (const entry of listed) {
    const clean = entry.replace(/\/$/, '');
    try {
      walk(clean);
    } catch {}
  }
  return out.sort();
}

/** Physical lines, the way an editor counts them. */
export function lineCount(rel, root = ROOT) {
  return readFileSync(join(root, rel), 'utf8').split('\n').length;
}

test('every shipped module is under the ceiling or explicitly migrating', () => {
  const over = shippedModules()
    .map((rel) => [rel, lineCount(rel)])
    .filter(([rel, lines]) => lines > LIMIT && !MIGRATION.has(rel));
  assert.deepEqual(over, [], `these modules exceed ${LIMIT} lines: ${over.map(([rel, n]) => `${rel} (${n})`).join(', ')}`);
});

test('the migration list never loses an entry it has not earned', () => {
  const stale = [...MIGRATION].filter((rel) => {
    try {
      return lineCount(rel) <= LIMIT;
    } catch {
      return true;
    }
  });
  assert.deepEqual(stale, [], `these files no longer need a migration entry, remove them: ${stale.join(', ')}`);
});

test('the ceiling is the same number the refactoring spec promises', () => {
  const spec = readFileSync(join(ROOT, 'openspec/changes/split-giant-files/specs/module-structure/spec.md'), 'utf8');
  assert.match(spec, /at most 500 lines/, 'the spec must state the ceiling this test enforces');
  assert.equal(LIMIT, 500, 'the test and the spec must agree on the number');
});
