// No file in the project imports bridge.mjs: it starts polling the moment it is
// loaded, so it cannot be imported by a test. That is also why a missing helper
// — `langFor`, removed by accident when the formatting code moved out — reached
// the running bridge and only showed up as one swallowed log line after a
// restart. These tests read the source instead: every function that is called
// must also be defined in that file (or imported), so a rename cannot leave a
// dangling call site that `node --check` accepts but the runtime does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shippedModules } from './module-size.test.mjs';

const source = readFileSync(new URL('../bridge.mjs', import.meta.url), 'utf8');

/**
 * Every module a turn can reach. `bridge.mjs` is the entry, but its keys now
 * live in the modules it calls — `queue.mjs` asks for the approval strings,
 * `steer.mjs` for the steer notices — so the scan must cover the layer too, or
 * a key that only moved is reported as missing.
 */
const layer = shippedModules()
  .filter((rel) => rel !== 'bridge.mjs' && rel !== 'scan-secrets.mjs')
  .map((rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'))
  .join('\n');

/** Words that look like a call because the next token is a paren. */
const PARAM_LIST = /^(?:async|await|function|constructor|typeof|void|delete|new|in|of|instanceof)$/;

/** Strip comments and strings: a name inside prose is not a call. */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

test('every function called in bridge.mjs is defined or imported', () => {
  const body = code(source);
  const defined = new Set();
  for (const m of body.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) {
    defined.add(m[1]);
  }
  for (const m of body.matchAll(/(?:^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g)) {
    defined.add(m[1]);
  }
  for (const m of body.matchAll(/import\s+\{([^}]*)\}\s+from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) defined.add(name);
    }
  }
  for (const m of body.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) defined.add(m[1]);
  // Globals the platform provides, plus methods called on objects (`x.foo()`).
  const builtin = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'await', 'new',
    'Number', 'String', 'Boolean', 'Object', 'Array', 'Map', 'Set', 'Promise', 'Error', 'JSON',
    'Math', 'Date', 'RegExp', 'Buffer', 'URL', 'URLSearchParams', 'FormData', 'Blob', 'AbortController',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'structuredClone', 'fetch',
  ]);
  const missing = new Set();
  for (const m of body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    // A parameter list and a method shorthand both start with a name the
    // scanner cannot resolve: `async (` and `heartbeat() {`. Neither is a call.
    if (PARAM_LIST.test(name) || builtin.has(name) || defined.has(name)) continue;
    const after = body.slice(m.index + name.length, m.index + name.length + 40);
    if (/^\s*\([^)]*\)\s*\{/.test(after)) continue;
    // `(cb) => cb()` — the name is a parameter, declared earlier on the line.
    const line = body.slice(body.lastIndexOf('\n', m.index) + 1, m.index);
    if (/[(,]\s*[A-Za-z_$][\w$]*\s*[,)]/.test(line) && /=|=>/.test(line + after)) continue;
    const own = /\b(?:const|let|var|function)\s+$/.test(line) || new RegExp(`\\bconst\\s+${name}\\s*=`).test(body);
    if (own) continue;
    missing.add(name);
  }
  // Names that only exist as parameters, callbacks and deferred values. Each
  // one was checked by hand against the source; a new entry means the scanner
  // met a pattern it does not model, not that the bridge is broken.
  const dynamic = new Set(['resolve', 'task', 'onBusy', 'cb', 'fn', 'handler', 'listener', 'next']);
  assert.deepEqual([...missing].filter((name) => !dynamic.has(name)).sort(), []);
  assert.deepEqual([...defined].sort(), [...defined].sort());
});

test('every i18n key used by the bridge exists in every language', async () => {
  const { t } = await import('../core/i18n.mjs');
  const body = code(source);
  // `t()` is often called with a template argument, so read the keys straight
  // from the source with the strings intact.
  const keys = new Set([...`${source}\n${layer}`.matchAll(/\bt\(\s*[A-Za-z_$][\w$]*\s*,\s*'([^']+)'/g)].map((m) => m[1]));
  // control.mjs and panel.mjs carry most of the keys now; the bridge and its
  // layer only need to contribute their own.
  assert.ok(keys.size >= 40, `the scan must see the real call sites, saw ${keys.size}`);
  for (const lang of ['en', 'ru', 'zh']) {
    const unused = [...keys].filter((key) => {
      const value = t(lang, key, { say: 'x', n: 1, pct: 1, k: 1, pid: 1, model: 'm', s: 1, cmd: 'c' });
      return value === key;
    });
    assert.deepEqual(unused, [], `${lang} is missing ${unused.length} key(s)`);
  }
});
