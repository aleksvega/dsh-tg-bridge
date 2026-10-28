// A module that calls a helper it never imported does not fail at load: the
// reference only explodes on the branch that uses it. That is how `/update`
// installed a release, then died on `saveState()` — the person saw "already on
// 1.22.0" three times because the confirmation was never recorded and the
// journal replayed the same command after every restart. `node --check` and the
// unit tests both miss it, because neither runs that branch.
//
// The helpers below are passed in through the command context or through a
// module export, so every bare call has to have a matching import, a local
// declaration, or a destructuring from `ctx`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const HELPERS = [
  'saveState', 'deliverTurn', 'redeliver', 'tg', 'sendFile', 'seedTopic', 'jobs',
  'prices', 'reply', 'say', 'activeTurns', 'saveDone', 'writeAtomic', 'pendingPath',
  'pendingUpdates', 'steerAvailable', 'steerRunningTurn', 'steerMediaMessage',
  'enqueue', 'ack', 'handleMessage',
];

function shippedFiles(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'test', 'openspec', 'docs'].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) shippedFiles(path, out);
    else if (name.endsWith('.mjs')) out.push(path);
  }
  return out;
}

/** Drop comments and string literals: prose is not a call. */
function codeOnly(src) {
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 1; out += ' '; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i += 1;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1; }
      out += '""';
      continue;
    }
    out += c;
  }
  return out;
}

const declares = (src, name) => new RegExp(
  `(?:const|let|var)\\s*\\{[^}]*\\b${name}\\b`
  + `|(?:const|let|var|function|class)\\s+${name}\\b`
  + `|import[^;]*\\b${name}\\b[^;]*from`
  + `|\\b${name}\\s*[,=}]`,
).test(src);

test('no shipped module calls a helper it never declared or imported', () => {
  const broken = [];
  for (const file of shippedFiles()) {
    const src = codeOnly(readFileSync(file, 'utf8'));
    for (const name of HELPERS) {
      if (!new RegExp(`(?<![.\\w$])${name}\\s*\\(`).test(src)) continue;
      if (declares(src, name)) continue;
      broken.push(`${relative(ROOT, file)} calls ${name}()`);
    }
  }
  assert.deepEqual(broken, [], `unresolved calls:\n${broken.join('\n')}`);
});
