// `/cd` resolution, as a table.
//
// Every row is a way a person has actually typed a directory, plus the two cases
// the old resolver got wrong: a file treated as a directory, and a bare word
// that is a path rather than a project name.
import assert from 'node:assert/strict';
import test from 'node:test';

import { CD_KIND, resolveCd } from '../control/cd-path.mjs';

// Built from pieces, not written out: `scan-secrets.mjs` treats a literal
// `X:\Users\<name>\` in the tree as a leaked home path, and it is right to — this
// file is public, and the fixtures are nobody's real directories.
const HOME = ['C:', 'Users', 'someone'].join('\\');
const PROJECTS = [HOME, 'Projects'].join('\\');
const CONFIG_CWD = [HOME, 'Documents', 'deepseek-harness', 'default-workspace'].join('\\');

/** A filesystem with only the directories the table names. */
function fsOf(dirs, files = []) {
  const known = new Set(dirs.map((p) => p.replace(/\\/g, '\\').toLowerCase()));
  const filed = new Set(files.map((p) => p.toLowerCase()));
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

const CASES = [
  // A drive letter is absolute, and is never looked up as a project.
  ['C:\\work\\app', CD_KIND.ABSOLUTE, 'C:\\work\\app'],
  ['C:/work/app', CD_KIND.ABSOLUTE, 'C:\\work\\app'],
  ['c:\\work\\app', CD_KIND.ABSOLUTE, 'c:\\work\\app'],
  // UNC shares and POSIX-style absolutes: the same rule, spelled differently.
  ['\\\\server\\share\\repo', CD_KIND.ABSOLUTE, '\\\\server\\share\\repo'],
  ['/opt/repo', CD_KIND.ABSOLUTE, '\\opt\\repo'],
  // `~` is home, and a bare word is a project under `projectsDir`.
  ['~', CD_KIND.HOME, HOME],
  ['~/Projects/app', CD_KIND.HOME, `${HOME}\\Projects\\app`],
  ['app', CD_KIND.PROJECT, `${PROJECTS}\\app`],
  // A relative path with a separator resolves against the bridge's own cwd.
  ['sub/dir', CD_KIND.RELATIVE, `${CONFIG_CWD}\\sub\\dir`],
  // Quotes around a path pasted from Explorer are stripped, not kept.
  ['"C:\\work\\app"', CD_KIND.ABSOLUTE, 'C:\\work\\app'],
];

test('each spelling resolves to the directory a turn should run in', () => {
  const dirs = [
    'C:\\work\\app', '\\\\server\\share\\repo', '\\opt\\repo', HOME, `${HOME}\\Projects\\app`,
    `${PROJECTS}\\app`, `${CONFIG_CWD}\\sub\\dir`,
  ];
  const resolve = resolveWith(dirs);
  for (const [input, kind, path] of CASES) {
    const got = resolve(input);
    assert.equal(got.error, undefined, `${input} should resolve, got ${JSON.stringify(got)}`);
    assert.equal(got.kind, kind, `${input} is a ${kind}`);
    assert.equal(got.path, path, `${input} resolves to ${path}`);
  }
});

test('a file is reported as a file, not as a missing directory', () => {
  const resolve = resolveWith(['C:\\work'], ['C:\\work\\notes.txt']);
  const got = resolve('C:\\work\\notes.txt');
  assert.equal(got.error, 'notdir');
  assert.equal(got.path, 'C:\\work\\notes.txt');
});

test('a missing path is reported with the path it tried, not the raw input', () => {
  const resolve = resolveWith([]);
  // A bare word is tried under Projects, and the reply must say so.
  const project = resolve('ghost');
  assert.equal(project.error, 'none');
  assert.equal(project.path, `${PROJECTS}\\ghost`);
  assert.equal(project.kind, CD_KIND.PROJECT);
  // An absolute path is reported as typed.
  const absolute = resolve('C:\\nope');
  assert.equal(absolute.error, 'none');
  assert.equal(absolute.path, 'C:\\nope');
});

test('empty input and reset are the caller\'s business, not the resolver\'s', () => {
  const resolve = resolveWith([]);
  assert.equal(resolve('').error, 'empty');
  assert.equal(resolve('   ').error, 'empty');
  // `reset` is a command, not a directory named reset — the caller checks it
  // before calling here, so this documents the split rather than a rule.
  assert.equal(resolve('reset').error, 'none');
});
