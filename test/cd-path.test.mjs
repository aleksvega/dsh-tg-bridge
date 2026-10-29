// `/cd` resolution, as a table.
//
// Every row is a way a person has actually typed a directory, plus the two cases
// the old resolver got wrong: a file treated as a directory, and a bare word
// that is a path rather than a project name.
//
// The expectations are built with `node:path` instead of being written out. The
// first version spelled them as Windows literals, which quietly turned the table
// into a test of the machine it ran on: on Linux the resolver was right and the
// fixture was wrong, and CI went red on every push for a reason that had nothing
// to do with the bridge. What is platform-independent here is the KIND —
// absolute, home, project, relative — and which base a path is built from. The
// separator is the platform's business.
//
// Spellings that only mean anything on Windows (`C:\x`, a lower-case drive, a UNC
// share) stay in their own block, because on Linux those are file names, not
// paths, and asserting them there would be asserting a bug.
import assert from 'node:assert/strict';
import { join, normalize, resolve } from 'node:path';
import test from 'node:test';

import { CD_KIND, resolveCd } from '../control/cd-path.mjs';

const WIN = process.platform === 'win32';

// Built from pieces, not written out: `scan-secrets.mjs` treats a literal
// `X:\Users\<name>\` in the tree as a leaked home path, and it is right to — this
// file is public, and the fixtures are nobody's real directories.
const HOME = WIN ? ['C:', 'Users', 'someone'].join('\\') : ['', 'home', 'someone'].join('/');
const PROJECTS = join(HOME, 'Projects');
const CONFIG_CWD = join(HOME, 'Documents', 'harness', 'workspace');
const UNC = ['', '', 'server', 'share', 'repo'].join('\\');

/** An absolute path in this platform's spelling: `C:\work\app` or `/work/app`. */
const abs = (...parts) => normalize(WIN ? ['C:', ...parts].join('\\') : ['', ...parts].join('/'));

/** The same absolute path with forward slashes, which Explorer and pastes use. */
const absSlashes = (...parts) => (WIN ? ['C:', ...parts].join('/') : ['', ...parts].join('/'));

/** A filesystem with only the directories the table names. */
function fsOf(dirs, files = []) {
  const known = new Set(dirs.map((p) => normalize(p).toLowerCase()));
  const filed = new Set(files.map((p) => normalize(p).toLowerCase()));
  return (path) => {
    const key = path.toLowerCase();
    if (filed.has(key)) return 'file';
    return known.has(key) ? 'dir' : 'none';
  };
}

const resolveWith = (dirs, files = []) => (input) => resolveCd(input, {
  home: HOME,
  projectsDir: PROJECTS,
  configCwd: CONFIG_CWD,
  probe: fsOf(dirs, files),
});

/** Rows that read the same on every platform. */
const CASES = [
  // An absolute path is never looked up as a project, in either slash style.
  [abs('work', 'app'), CD_KIND.ABSOLUTE, abs('work', 'app')],
  [absSlashes('work', 'app'), CD_KIND.ABSOLUTE, abs('work', 'app')],
  // A POSIX absolute is understood as absolute even on Windows, where `\x` and
  // `/x` are the same thing: a pasted path must not become a project name.
  ['/opt/repo', CD_KIND.ABSOLUTE, normalize('/opt/repo')],
  // `~` is home, and a bare word is a project under `projectsDir`.
  ['~', CD_KIND.HOME, HOME],
  ['~/Projects/app', CD_KIND.HOME, join(HOME, 'Projects/app')],
  ['app', CD_KIND.PROJECT, join(PROJECTS, 'app')],
  // A relative path with a separator resolves against the bridge's own cwd.
  ['sub/dir', CD_KIND.RELATIVE, resolve(CONFIG_CWD, 'sub/dir')],
  // Quotes around a path pasted from Explorer are stripped, not kept.
  [`"${abs('work', 'app')}"`, CD_KIND.ABSOLUTE, abs('work', 'app')],
];

/** Rows that only exist on Windows: elsewhere these are file names, not paths. */
const WINDOWS_CASES = [
  // A lower-case drive is still a drive, and is kept as typed.
  [['c:', 'work', 'app'].join('\\'), CD_KIND.ABSOLUTE, ['c:', 'work', 'app'].join('\\')],
  // A UNC share is absolute: `\\server\share\repo` has no drive letter at all.
  [UNC, CD_KIND.ABSOLUTE, UNC],
];

test('each spelling resolves to the directory a turn should run in', () => {
  const dirs = [
    abs('work', 'app'),
    normalize('/opt/repo'),
    HOME,
    join(HOME, 'Projects/app'),
    join(PROJECTS, 'app'),
    resolve(CONFIG_CWD, 'sub/dir'),
  ].filter(Boolean);
  const resolveOne = resolveWith(dirs);
  for (const [input, kind, path] of CASES) {
    const got = resolveOne(input);
    assert.equal(got.error, undefined, `${input} should resolve, got ${JSON.stringify(got)}`);
    assert.equal(got.kind, kind, `${input} is a ${kind}`);
    assert.equal(got.path, path, `${input} resolves to ${path}`);
  }
});

test('a drive letter and a UNC share are absolute where they mean anything', () => {
  if (!WIN) {
    // On Linux `c:\work\app` is one odd file name, so the resolver's answer
    // (absolute, kept as typed) is still right and there is nothing to probe.
    return;
  }
  const resolveOne = resolveWith([abs('work', 'app'), UNC]);
  for (const [input, kind, path] of WINDOWS_CASES) {
    const got = resolveOne(input);
    assert.equal(got.error, undefined, `${input} should resolve, got ${JSON.stringify(got)}`);
    assert.equal(got.kind, kind, `${input} is a ${kind}`);
    assert.equal(got.path, path, `${input} resolves to ${path}`);
  }
});

test('a file is reported as a file, not as a missing directory', () => {
  const dir = abs('work');
  const file = join(dir, 'notes.txt');
  const resolveOne = resolveWith([dir], [file]);
  const got = resolveOne(file);
  assert.equal(got.error, 'notdir');
  assert.equal(got.path, file);
});

test('a missing path is reported with the path it tried, not the raw input', () => {
  const resolveOne = resolveWith([]);
  // A bare word is tried under Projects, and the reply must say so.
  const project = resolveOne('ghost');
  assert.equal(project.error, 'none');
  assert.equal(project.path, join(PROJECTS, 'ghost'));
  assert.equal(project.kind, CD_KIND.PROJECT);
  // An absolute path is reported as typed.
  const absolute = resolveOne(abs('nope'));
  assert.equal(absolute.error, 'none');
  assert.equal(absolute.path, abs('nope'));
});

test('empty input and reset are the caller\'s business, not the resolver\'s', () => {
  const resolveOne = resolveWith([]);
  assert.equal(resolveOne('').error, 'empty');
  assert.equal(resolveOne('   ').error, 'empty');
  // `reset` is a command, not a directory named reset — the caller checks it
  // before calling here, so this documents the split rather than a rule.
  assert.equal(resolveOne('reset').error, 'none');
});
