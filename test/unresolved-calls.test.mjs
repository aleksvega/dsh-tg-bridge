// A module that calls a helper it never imported does not fail at load: the
// reference only explodes on the branch that uses it. That is how `/update`
// installed a release, then died on `saveState()` — the person saw "already on
// 1.22.0" three times because the confirmation was never recorded and the journal
// replayed the same command after every restart. `node --check` and the unit
// tests both miss it, because neither runs that branch.
//
// The first version of this file collected every parameter name in a file into
// one set, so a `t` that some other function happened to take as an argument made
// `t` visible everywhere — which is exactly how `/model` shipped calling `t`
// without importing it. The check is scope-aware now: a name is visible because
// this module imports it, declares it at the top, binds it in an enclosing
// function, or declares it anywhere in that function. A parameter of a neighbour
// no longer counts.
//
// Shorthand properties are checked too: `{ t }` fails the same way `t(...)` does,
// and a card that builds its rows as objects is where that shape lives.
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
 *
 * Newlines survive blanking, so a reported line number is the real one: a block
 * comment is many lines long, and collapsing it into one space shifted every
 * line after it.
 */
function codeOnly(src) {
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; out += '\n'; continue; }
    if (c === '/' && n === '*') {
      i += 2;
      let blanks = ' ';
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') blanks += '\n';
        i += 1;
      }
      i += 1;
      out += blanks;
      continue;
    }
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
      let blanks = ' "" ';
      i += 1;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i += 1;
        else if (src[i] === '\n' && q === '`') blanks += '\n';
        i += 1;
      }
      out += blanks;
      continue;
    }
    out += c;
  }
  return out;
}

/** Index of the brace that closes the one at `open`, or -1. */
function matchBrace(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Index of the paren that closes the one at `open`, or -1. */
function matchParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Identifiers a parameter list binds, defaults and destructuring included. */
function parameterNames(list) {
  return [...list.matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]);
}

/**
 * Function scopes: where a body starts and ends, and which names its parameters
 * bind inside it. Expression-bodied arrows end at the next semicolon, which is
 * enough to cover `(row, value, t) => (… t(…) …)`.
 */
function functionScopes(code) {
  const out = [];
  for (const m of code.matchAll(/\bfunction\s*[A-Za-z_$]*\s*\(/g)) {
    const open = code.indexOf('(', m.index);
    const close = matchParen(code, open);
    if (close < 0) continue;
    const body = code.indexOf('{', close);
    if (body < 0) continue;
    const end = matchBrace(code, body);
    if (end < 0) continue;
    out.push({ start: body, end, params: new Set(parameterNames(code.slice(open + 1, close))), paramOpen: open, paramClose: close });
  }
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>\s*\{/g)) {
    const body = code.indexOf('{', m.index);
    const end = matchBrace(code, body);
    if (end < 0) continue;
    out.push({ start: body, end, params: new Set(parameterNames(m[1])), paramOpen: m.index, paramClose: code.indexOf(')', m.index) });
  }
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>\s*(?!\{)/g)) {
    const start = code.indexOf('=>', m.index);
    let end = code.indexOf(';', start);
    if (end < 0) end = code.length;
    out.push({ start, end, params: new Set(parameterNames(m[1])), paramOpen: m.index, paramClose: code.indexOf(')', m.index) });
  }
  return out;
}

/** Names this module binds at its own top level: imports and declarations. */
function moduleNames(code) {
  const names = new Set();
  for (const m of code.matchAll(/import\s+([\s\S]*?)\s+from/g)) {
    for (const part of m[1].replace(/[{}]/g, ' ').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const m of code.matchAll(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  return names;
}

/** Names declared anywhere in the file, at any depth. */
function declaredNames(code) {
  const names = new Set();
  for (const m of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().replace(/=.*/, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  for (const m of code.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  return names;
}

/**
 * Bare references to `exported` names that nothing in this module binds.
 *
 * `code` must already be blanked by `codeOnly`. Returns `{ line, kind, name }`
 * for each hit so a failure reads as "line 42 uses `t` as a shorthand property".
 */
export function missingRefs(blanked, exported) {
  const mod = moduleNames(blanked);
  const declared = declaredNames(blanked);
  const spans = functionScopes(blanked);
  const hits = [];
  const lines = blanked.split('\n');
  const lineOf = (at) => blanked.slice(0, at).split('\n').length;

  const patterns = [
    // A call, or `new Foo(`: not a member access, not a definition.
    { re: /(?<![.\w$'"`])([A-Za-z_$][\w$]*)\s*\(/g, kind: 'call' },
    // A shorthand property: `{ t }` or `{ t, other }`.
    { re: /(?<![.\w$])\{\s*([A-Za-z_$][\w$]*)\s*[,}]/g, kind: 'shorthand' },
  ];
  for (const { re, kind } of patterns) {
    for (const m of blanked.matchAll(re)) {
      const name = m[1];
      if (!exported.has(name)) continue;
      if (mod.has(name) || declared.has(name)) continue;
      const at = m.index;
      // Inside a signature, `{ t }` binds the parameter rather than using it.
      if (spans.some((s) => s.paramOpen < at && at < s.paramClose)) continue;
      if (spans.some((s) => s.start < at && at < s.end && s.params.has(name))) continue;
      // An object literal method `name(...) {` defines a property; it is not a
      // reference to a function of that name.
      const open = blanked.indexOf('(', at);
      if (kind === 'call' && open >= 0 && /^\s*\([^()]*\)\s*\{/.test(blanked.slice(open))) continue;
      hits.push({ line: lineOf(at), kind, name, text: (lines[lineOf(at) - 1] || '').trim().slice(0, 80) });
    }
  }
  return hits;
}

/** Names any module exports: the candidates a bare reference could resolve to. */
function exportedNames(files) {
  const names = new Set();
  for (const { code } of files) {
    for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
    for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name) names.add(name);
      }
    }
  }
  return names;
}

// ------------------------------------------------------------ the guard itself

test('a parameter of one function does not make the name visible in another', () => {
  const code = codeOnly(`
    function one(t) { return t('a'); }
    function two() { return t('b'); }
  `);
  const hits = missingRefs(code, new Set(['t']));
  assert.equal(hits.length, 1, 'only the second function is broken');
  assert.equal(hits[0].name, 't');
  assert.equal(hits[0].kind, 'call');
});

test('a shorthand property is checked as well as a call', () => {
  const code = codeOnly(`
    function one(t) { return t('a'); }
    function two() { return { t }; }
  `);
  const hits = missingRefs(code, new Set(['t']));
  assert.equal(hits.length, 1, 'the shorthand reference has no binding either');
  assert.equal(hits[0].kind, 'shorthand');
});

test('a destructured parameter binds the name inside its own body', () => {
  const code = codeOnly(`
    function render({ t }) { return { text: t('k') }; }
    const arrow = (t) => t('k');
    const expression = (row, value, t) => (row ? t('k') : value);
  `);
  assert.deepEqual(missingRefs(code, new Set(['t'])), []);
});

test('a module-level import or declaration is visible everywhere in the file', () => {
  const code = codeOnly(`
    import { t } from './i18n.mjs';
    const label = () => { const nested = t('k'); return { nested }; };
    function other() { return { t }; }
  `);
  assert.deepEqual(missingRefs(code, new Set(['t'])), []);
});

// ------------------------------------------------------------ the whole tree

test('no module calls a name exported elsewhere without importing or declaring it', () => {
  const files = shippedFiles().map((path) => ({ path, code: codeOnly(readFileSync(path, 'utf8')) }));
  const exported = exportedNames(files);
  const broken = [];
  for (const { path, code } of files) {
    for (const hit of missingRefs(code, exported)) {
      broken.push(`${relative(ROOT, path)}:${hit.line} ${hit.kind} ${hit.name} — ${hit.text}`);
    }
  }
  assert.deepEqual(broken, [], `names with no binding in this module:\n${broken.join('\n')}`);
});