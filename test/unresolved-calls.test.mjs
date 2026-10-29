// A module that calls a helper it never imported does not fail at load: the
// reference only explodes on the branch that uses it. That is how `/update`
// installed a release, then died on `saveState()` — the person saw "already on
// 1.22.0" three times because the confirmation was never recorded and the journal
// replayed the same command after every restart. `node --check` and the unit
// tests both miss it, because neither runs that branch.
//
// This file used to check a hand-written list of helper names, and the list is
// what failed: when the 500-line split moved `cardKeyboard` out of `control.mjs`
// into `aset-schema.mjs`, the call inside `agentsetKeyboard` kept the old name
// and the list did not mention it. The rule needs no list. A name exported by any
// module here, called without a member access, must be imported, declared
// locally, or bound as a parameter of the function that calls it — otherwise that
// line throws the moment it runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function shippedFiles(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'test', 'openspec', 'docs'].includes(name)) continue;
    if (name.startsWith('update-backup')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) shippedFiles(path, out);
    else if (name.endsWith('.mjs')) out.push(path);
  }
  return out;
}

/** True when the `/` at `i` opens a regular expression rather than dividing. */
function startsRegex(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j -= 1;
  if (j < 0) return true;
  if ('(,=:[!&|?{};+-*%~^<>'.includes(src[j])) return true;
  const word = /([A-Za-z_$][\w$]*)\s*$/.exec(src.slice(Math.max(0, j - 12), j + 1));
  return Boolean(word && ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void'].includes(word[1]));
}

/**
 * Source with comments, strings and regex literals blanked out. Prose is not a
 * call, a string is not a call, and a pattern like `/running \(/` is not one
 * either — all three used to produce false hits.
 */
function codeOnly(src) {
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1; i += 1; out += ' '; continue; }
    if (c === '/' && startsRegex(src, i)) {
      i += 1;
      while (i < src.length && src[i] !== '/') {
        if (src[i] === '\\') i += 1;
        else if (src[i] === '\n') break;
        i += 1;
      }
      while (i + 1 < src.length && /[a-z]/.test(src[i + 1])) i += 1;
      out += ' "" ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i += 1;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1; }
      out += ' "" ';
      continue;
    }
    out += c;
  }
  return out;
}

const FILES = shippedFiles().map((path) => ({ path, code: codeOnly(readFileSync(path, 'utf8')) }));

/** Every name any module exports: the candidates a bare call could resolve to. */
function exportedNames() {
  const names = new Set();
  for (const { code } of FILES) {
    for (const m of code.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    for (const m of code.matchAll(/export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) names.add(name);
      }
    }
  }
  return names;
}

/** Identifiers a parameter list binds, defaults and destructuring included. */
function parameterNames(list) {
  const names = [];
  let depth = 0;
  let part = '';
  const parts = [];
  for (const ch of list) {
    if ('({['.includes(ch)) depth += 1;
    if (')}]'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(part); part = ''; continue; }
    part += ch;
  }
  parts.push(part);

  for (const raw of parts) {
    // Cut the default value at depth 0: `reasoningOf = null` binds reasoningOf.
    let d = 0;
    let cut = raw.length;
    for (let i = 0; i < raw.length; i += 1) {
      if ('({['.includes(raw[i])) d += 1;
      if (')}]'.includes(raw[i])) d -= 1;
      if (raw[i] === '=' && d === 0) { cut = i; break; }
    }
    for (const m of raw.slice(0, cut).matchAll(/[A-Za-z_$][\w$]*/g)) names.push(m[0]);
  }
  return names;
}

/** Names a module can legitimately call: imports, declarations, parameters. */
function visibleNames(code) {
  const names = new Set();
  const add = (name) => { if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name); };

  for (const m of code.matchAll(/import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g)) {
    add(m[1] || '');
    for (const part of (m[2] || '').split(',')) add(part.split(/\s+as\s+/).pop().trim());
  }
  for (const m of code.matchAll(/(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) add(part.split(':').pop().replace(/=.*/, '').trim());
  }
  // Every parenthesised list that is followed by a body or an arrow, plus the
  // parameter list of a `function` — a call never binds a name.
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] !== '(') continue;
    let depth = 0;
    let j = i;
    for (; j < code.length; j += 1) {
      if (code[j] === '(') depth += 1;
      else if (code[j] === ')') { depth -= 1; if (depth === 0) break; }
    }
    const after = code.slice(j + 1, j + 12);
    const before = code.slice(Math.max(0, i - 40), i);
    const signature = /^\s*(?:=>|\{)/.test(after) || /function\s*[\w$]*\s*$/.test(before);
    if (!signature) continue;
    for (const name of parameterNames(code.slice(i + 1, j))) add(name);
  }
  return names;
}

test('no module calls a name exported elsewhere without importing or declaring it', () => {
  const exported = exportedNames();
  const broken = [];
  for (const { path, code } of FILES) {
    const visible = visibleNames(code);
    for (const name of exported) {
      if (visible.has(name)) continue;
      const call = new RegExp(`(?<![.\\w$])${name}\\s*\\(`);
      const hit = code.split('\n').find((line) => call.test(line)
        // `name() {}` in an object literal defines a method; it does not call one.
        && !/^\s*[A-Za-z_$][\w$]*\s*\([^()]*\)\s*\{[^{}]*\},?\s*$/.test(line)
        && !new RegExp(`(?:function|const|let|var|class)\\s+${name}\\b`).test(line));
      if (hit) broken.push(`${relative(ROOT, path)} calls ${name}()`);
    }
  }
  assert.deepEqual(broken, [], `calls with no import:\n${broken.join('\n')}`);
});
