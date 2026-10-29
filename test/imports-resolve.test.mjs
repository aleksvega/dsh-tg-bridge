// Every name a module imports from another module actually exists there.
//
// This is the failure that nearly shipped 1.29.0: a new module imported
// `profileOf` from `control/models.mjs`, which exports `modelsOf` and `modelOf`
// but never `profileOf`. Node does not complain until the module is loaded, and
// no test loaded that file, so 557 green tests said nothing — the bridge would
// have thrown `does not provide an export named 'profileOf'` on the first
// message of the first turn, and looked like a bot that had simply stopped.
//
// The check is static on purpose: importing every module for real would run
// their top-level code (reading the state file, opening the log), and a test
// suite must not need a live installation to say whether the code can load.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { shippedModules } from './module-size.test.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every name a module exports, as far as a regex can honestly tell. */
function exportsOf(rel) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  const names = new Set();
  for (const match of text.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(match[1]);
  }
  // `export { a, b as c }` and `export { x } from './y.mjs'`
  for (const match of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const alias = /\sas\s+([A-Za-z_$][\w$]*)$/.exec(piece);
      names.add(alias ? alias[1] : piece);
    }
  }
  // A star re-export could carry anything; treat it as unknowable rather than
  // guess, so this test never reports a false alarm.
  if (/^export\s+\*\s+from/m.test(text)) names.add('*');
  if (/^export\s+default\b/m.test(text)) names.add('default');
  return names;
}

/** Named imports of relative modules, resolved to repo-relative paths. */
function namedImports(rel) {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  const out = [];
  for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.[^']*)'/g)) {
    const target = normalize(join(dirname(rel), match[2])).split('\\').join('/');
    const file = target.endsWith('.mjs') || target.endsWith('.js') ? target : `${target}.mjs`;
    for (const part of match[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      // `a as b` asks the target for `a`.
      out.push({ name: piece.split(/\s+as\s+/)[0].trim(), target: file });
    }
  }
  return out;
}

test('every named import exists in the module it comes from', () => {
  const cache = new Map();
  const missing = [];
  for (const rel of shippedModules()) {
    for (const { name, target } of namedImports(rel)) {
      let names = cache.get(target);
      if (!names) {
        try {
          names = exportsOf(target);
        } catch {
          // A target that does not exist is the other test's business.
          continue;
        }
        cache.set(target, names);
      }
      if (names.has('*') || names.has(name)) continue;
      missing.push(`${rel} imports ${name} from ${target}, which does not export it`);
    }
  }
  assert.deepEqual(missing, [], `\n${missing.join('\n')}`);
});

test('every relative import points at a file that exists', () => {
  // The tarball test covers "is it published"; this covers "is it on disk at
  // all", which is the state a half-finished rename leaves behind.
  const broken = [];
  for (const rel of shippedModules()) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    for (const match of text.matchAll(/from\s+'(\.[^']*)'/g)) {
      const target = normalize(join(dirname(rel), match[1])).split('\\').join('/');
      const file = target.endsWith('.mjs') || target.endsWith('.js') ? target : `${target}.mjs`;
      try {
        statSync(join(ROOT, file));
      } catch {
        broken.push(`${rel}: imports ${file}, which is not on disk`);
      }
    }
  }
  assert.deepEqual(broken, [], `\n${broken.join('\n')}`);
});

test('the check can actually fail', () => {
  // Guard against a refactor that quietly makes `exportsOf` stop seeing
  // `export function`: a check that cannot fail is worse than no check.
  const names = exportsOf('control/models.mjs');
  assert.ok(names.has('modelOf'), 'exportsOf missed a real export');
  assert.ok(!names.has('profileOf'), 'exportsOf invented an export');
});

test('no scratch script is left in the repo root', () => {
  // A temporary `.mjs` written mid-turn is how half-finished code reaches a
  // release. The tarball test checks what ships; this checks what is lying
  // around, and only for code — logs and data files are not code.
  const stray = readdirSync(ROOT)
    .filter((name) => /^(tmp-|scratch-).*\.mjs$/.test(name))
    .filter((name) => {
      try {
        return statSync(join(ROOT, name)).isFile();
      } catch {
        return false;
      }
    });
  assert.deepEqual(stray, [], `scratch scripts in the repo root: ${stray.join(', ')}`);
});
