// Which DSH is installed, which one npm has, and whether this bridge was ever
// tested against the first one.
//
// Three separate facts, and the reason they are a module: the two questions come
// from different places (`dsh --version` is a 1.1 s subprocess, npm is a network
// round trip that can take 45 s), and the answer to the third is a range in this
// package's own `engines.dsh`. `/dsh` and `/doctor` ask all three; nothing here
// writes anything.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
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

/**
 * One JSON file out of an Electron `asar` archive, or null.
 *
 * The archive is a pickled header — sizes, then the directory tree as JSON —
 * followed by the files back to back, and every entry says where its bytes start.
 * Reading it directly is what lets `/dsh` answer "the app carries 0.2.1-rc.3"
 * without starting the app: the alternative was asking nobody and printing
 * "version unknown" on the one screen that exists to name versions.
 */
export function asarJson(archive, entry) {
  let fd = null;
  try {
    fd = openSync(archive, 'r');
    const head = Buffer.alloc(8);
    readSync(fd, head, 0, 8, 0);
    const headerSize = head.readUInt32LE(4);
    if (!headerSize || headerSize > 64 * 1024 * 1024) return null;
    const header = Buffer.alloc(headerSize);
    readSync(fd, header, 0, headerSize, 8);
    const jsonSize = header.readUInt32LE(4);
    const tree = JSON.parse(header.subarray(8, 8 + jsonSize).toString('utf8'));
    let node = tree;
    for (const part of String(entry).split('/').filter(Boolean)) {
      node = node?.files?.[part];
      if (!node) return null;
    }
    const size = Number(node.size) || 0;
    const offset = Number(node.offset) || 0;
    if (!size) return null;
    const body = Buffer.alloc(size);
    readSync(fd, body, 0, size, 8 + headerSize + offset);
    return JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

/**
 * The DSH version the desktop app carries, or '' when this is not an app install.
 *
 * The app runs its own copy of the CLI out of `app.asar`, so `dsh --version` has
 * nothing to answer here — and a card that stops at "unknown" leaves the person
 * with no way to tell whether they are current.
 */
export function appDshVersion(exe = '') {
  if (!exe) return '';
  const root = dirname(String(exe));
  const candidates = [
    join(root, 'resources', 'app.asar'),
    join(dirname(root), 'Resources', 'app.asar'),
  ];
  for (const archive of candidates) {
    if (!existsSync(archive)) continue;
    const pkg = asarJson(archive, 'dsh/node_modules/@deepseek-ai/dsh/package.json');
    const version = parseVersion(pkg?.version);
    if (version) return `${version.major}.${version.minor}.${version.patch}${version.pre.length ? `-${version.pre.join('.')}` : ''}`;
  }
  return '';
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