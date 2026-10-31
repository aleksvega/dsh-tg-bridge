// Which DSH is installed, which one npm has, and whether this bridge was ever
// tested against the first one.
//
// Three separate facts, and the reason they are a module: the two questions come
// from different places (`dsh --version` is a 1.1 s subprocess, npm is a network
// round trip that can take 45 s), and the answer to the third is a range in this
// package's own `engines.dsh`. `/dsh` and `/doctor` ask all three; nothing here
// writes anything.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DSH_CMD } from './paths.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * `1.2.3-rc.4` as comparable parts, or null when the text is not a version.
 *
 * Hand-written because the alternative is a dependency: the comparison this
 * needs is thirty lines, and semver's 6 MB of edge cases (build metadata,
 * hyphen ranges) are not among them.
 */
export function parseVersion(text) {
  // Trailing whitespace only: `dsh --version` ends with a newline, and a line
  // that says something else after the number is a sentence, not a version.
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

/** -1, 0 or 1. A release outranks any of its prereleases: 0.2.1 > 0.2.1-rc.5. */
export function compareVersions(a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a;
  const y = typeof b === 'string' ? parseVersion(b) : b;
  if (!x || !y) return null;
  if (x.major !== y.major) return x.major < y.major ? -1 : 1;
  if (x.minor !== y.minor) return x.minor < y.minor ? -1 : 1;
  if (x.patch !== y.patch) return x.patch < y.patch ? -1 : 1;
  return comparePre(x.pre, y.pre);
}

function comparePre(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) {
      if (Number(left) !== Number(right)) return Number(left) < Number(right) ? -1 : 1;
    } else if (leftNumeric !== rightNumeric) {
      // Numeric identifiers sort below alphanumeric ones: 1.0.0-1 < 1.0.0-alpha.
      return leftNumeric ? -1 : 1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Is `version` inside `range`? `null` when either cannot be read: "not a
 * version" and "not in the range" are different answers and a caller that
 * prints "incompatible" for a typo would be lying.
 *
 * Supports what `engines` uses in practice: `||` alternatives and `>`, `>=`,
 * `<`, `<=`, `=` comparators joined by spaces.
 */
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return null;
  const parts = String(range ?? '').split('||').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  return parts.some((part) => part.split(/\s+/).every((test) => {
    const m = /^(>=|<=|>|<|=)?(.+)$/.exec(test);
    const bound = parseVersion(m[2]);
    if (!bound) return false;
    const c = compareVersions(v, bound);
    switch (m[1] || '=') {
      case '>=': return c >= 0;
      case '<=': return c <= 0;
      case '>': return c > 0;
      case '<': return c < 0;
      default: return c === 0;
    }
  }));
}

/** The range this package declares it was built against, or '' when absent. */
export function testedRange() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    return String(pkg?.engines?.dsh || '');
  } catch {
    return '';
  }
}

/**
 * What `dsh --version` says. A subprocess per call would be 1.1 s per command
 * and the answer cannot change while the process runs, so it is read once.
 */
let installedCache = null;

export function installedDsh({ run = null, fresh = false } = {}) {
  if (!fresh && installedCache !== null) return installedCache;
  const runner = run || (() => {
    try {
      const r = spawnSync(DSH_CMD, ['--version'], { encoding: 'utf8', timeout: 20000, windowsHide: true, shell: true });
      return r.status === 0 ? String(r.stdout || '') : '';
    } catch {
      return '';
    }
  });
  const version = parseVersion(runner());
  installedCache = version ? `${version.major}.${version.minor}.${version.patch}${version.pre.length ? `-${version.pre.join('.')}` : ''}` : '';
  return installedCache;
}

/** Forget the reading above; the command that installs a version calls this. */
export function forgetInstalledDsh() {
  installedCache = null;
}

/**
 * The newest published DSH, asked without blocking the event loop.
 *
 * The command may wait a few seconds; the poll loop may not, because a stalled
 * `npm view` there also stops `getUpdates`. Empty string means "could not ask",
 * which the card prints as such instead of as "up to date".
 */
export function latestDsh({ timeoutMs = 6000, argv = ['npm', 'view', '@deepseek-ai/dsh', 'version'] } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { shell: true, windowsHide: true });
    } catch {
      resolve('');
      return;
    }
    const done = (value) => {
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      done('');
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => {
      out += chunk;
    });
    child.on('error', () => done(''));
    child.on('close', () => {
      const last = String(out).trim().split(/\s+/).pop() || '';
      done(parseVersion(last) ? last : '');
    });
  });
}

/**
 * The three facts together. `tested` is `true`, `false` or `null` (unknown
 * version, no range) — a caller must print the third case differently, because
 * "never checked" is not "checked and failed".
 */
export function dshStatus({ installed, latest = '', range = testedRange() }) {
  const behind = latest && installed ? compareVersions(installed, latest) : null;
  return {
    installed: installed || '',
    latest: latest || '',
    range,
    tested: installed ? satisfies(installed, range) : null,
    outdated: behind === -1,
  };
}