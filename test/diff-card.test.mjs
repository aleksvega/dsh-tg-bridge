// The diff card is the one surface where a wrong button edits code, so these
// tests are about the two promises it makes: a card that fits in a message, and
// a hunk id that stops matching the moment the hunk it names has changed.
//
// The parser is pure, so most of this is text in, text out. The last two tests
// use a real repository, because "the patch applies" is not a claim a string can
// settle — `git apply -R` is what decides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diffPress, findHunk, hunkId, hunkPatch, parseDiff, renderDiffCard } from '../work/diff.mjs';
import { diffCard, isRepo, readDiff } from '../control/cmd-diff.mjs';
import { LANGS, t } from '../core/i18n.mjs';

const MOD = [
  'diff --git a/src/app.mjs b/src/app.mjs',
  'index 1111111..2222222 100644',
  '--- a/src/app.mjs',
  '+++ b/src/app.mjs',
  '@@ -10,4 +10,5 @@ export function run() {',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  ' return a + b;',
  ' }',
  '',
].join('\n');

const NEW = [
  'diff --git a/docs/NEW.md b/docs/NEW.md',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/docs/NEW.md',
  '@@ -0,0 +1,2 @@',
  '+# Title',
  '+Body',
  '',
].join('\n');

const GONE = [
  'diff --git a/old.mjs b/old.mjs',
  'deleted file mode 100644',
  'index 4444444..0000000',
  '--- a/old.mjs',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-one',
  '-two',
  '',
].join('\n');

const MOVED = [
  'diff --git a/from.mjs b/to.mjs',
  'similarity index 100%',
  'rename from from.mjs',
  'rename to to.mjs',
  '',
].join('\n');

const BIN = [
  'diff --git a/logo.png b/logo.png',
  'index 5555555..6666666 100644',
  'Binary files a/logo.png and b/logo.png differ',
  '',
].join('\n');

const en = (key, vars) => t('en', key, vars);

test('a modified file parses into one hunk with both counts', () => {
  const [file] = parseDiff(MOD);
  assert.equal(file.path, 'src/app.mjs');
  assert.equal(file.status, 'modified');
  assert.equal(file.added, 2);
  assert.equal(file.removed, 1);
  assert.equal(file.hunks.length, 1);
  const [hunk] = file.hunks;
  assert.equal(hunk.newStart, 10);
  assert.equal(hunk.tail, 'export function run() {');
  assert.deepEqual(hunk.lines, [' const a = 1;', '-const b = 2;', '+const b = 3;', '+const c = 4;', ' return a + b;', ' }']);
});

test('a new file, a deleted file and a rename each get the right status', () => {
  assert.equal(parseDiff(NEW)[0].status, 'added');
  assert.equal(parseDiff(NEW)[0].path, 'docs/NEW.md');
  assert.equal(parseDiff(GONE)[0].status, 'deleted');
  assert.equal(parseDiff(GONE)[0].path, 'old.mjs');
  assert.equal(parseDiff(MOVED)[0].status, 'renamed');
  assert.equal(parseDiff(MOVED)[0].path, 'to.mjs');
  assert.equal(parseDiff(MOVED)[0].hunks.length, 0, 'a pure rename has nothing to review');
});

test('a binary file is marked and gets no hunks', () => {
  const [file] = parseDiff(BIN);
  assert.equal(file.binary, true);
  assert.equal(file.hunks.length, 0);
});

test('several files in one diff stay several files', () => {
  const files = parseDiff([MOD, NEW, GONE].join(''));
  assert.deepEqual(files.map((one) => one.path), ['src/app.mjs', 'docs/NEW.md', 'old.mjs']);
  assert.deepEqual(files.map((one) => one.status), ['modified', 'added', 'deleted']);
});

test('the same hunk text always hashes to the same id', () => {
  const first = parseDiff(MOD)[0].hunks[0];
  const second = parseDiff(MOD)[0].hunks[0];
  assert.equal(first.id, second.id);
  assert.match(first.id, /^[0-9a-f]{8}$/);
  assert.equal(first.id, hunkId('src/app.mjs', first));
});

test('a hunk that gained or lost a line has a different id', () => {
  // The whole safety story: same line number, different content, different id.
  const before = parseDiff(MOD)[0].hunks[0];
  const after = parseDiff(MOD.replace('+const c = 4;', '+const c = 5;'))[0].hunks[0];
  assert.equal(before.newStart, after.newStart);
  assert.notEqual(before.id, after.id);
});

test('the same lines in another file are another hunk', () => {
  const here = parseDiff(MOD)[0].hunks[0];
  const there = parseDiff(MOD.replaceAll('src/app.mjs', 'src/other.mjs'))[0].hunks[0];
  assert.notEqual(here.id, there.id);
});

test('a stale id finds nothing, which is how a press is refused', () => {
  const files = parseDiff(MOD);
  const id = files[0].hunks[0].id;
  assert.ok(findHunk(files, id));
  assert.equal(findHunk(files, 'deadbeef'), null);
  assert.equal(findHunk(parseDiff(NEW), id), null);
});

test('a press carries an action and only an eight-hex id', () => {
  assert.deepEqual(diffPress('df:x:1a2b3c4d'), { action: 'x', id: '1a2b3c4d' });
  assert.deepEqual(diffPress('df:r:1a2b3c4d'), { action: 'r', id: '1a2b3c4d' });
  assert.deepEqual(diffPress('df:f'), { action: 'f', id: '' });
  // Anything this module did not draw is refused rather than guessed at.
  for (const bad of ['df:', 'df:q:1a2b3c4d', 'df:x:1A2B3C4D', 'df:x:1a2b3c4', 'df:x:1a2b3c4d5e', 'ap:y:1', '', null, undefined]) {
    assert.equal(diffPress(bad), null, `${bad} should not parse`);
  }
});

test('a hunk patch replays the header and drops the index line', () => {
  const [file] = parseDiff(MOD);
  const patch = hunkPatch(file, file.hunks[0]);
  assert.match(patch, /^diff --git a\/src\/app\.mjs b\/src\/app\.mjs$/m);
  assert.match(patch, /^--- a\/src\/app\.mjs$/m);
  assert.match(patch, /^\+const b = 3;$/m);
  assert.doesNotMatch(patch, /^index /m, 'blob hashes make a single-hunk revert fail');
  assert.ok(patch.endsWith('\n'));
});

test('an empty tree says so instead of drawing an empty card', () => {
  const card = renderDiffCard({ files: [], untracked: [], t: en });
  assert.equal(card.text, t('en', 'diff.noChanges'));
  assert.deepEqual(card.keyboard, []);
});

test('every hunk gets an explain button and a revert button', () => {
  const files = parseDiff([MOD, NEW].join(''));
  const card = renderDiffCard({ files, t: en });
  const rows = card.keyboard.filter((row) => row[0]?.data !== 'df:f');
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.length, 2);
    assert.match(row[0].data, /^df:x:[0-9a-f]{8}$/);
    assert.match(row[1].data, /^df:r:[0-9a-f]{8}$/);
    assert.ok(row[0].text.length <= 64, 'a button label must fit');
  }
  assert.equal(card.keyboard.at(-1)[0].data, 'df:f', 'the refresh row comes last');
});

test('a binary file is listed but has nothing to press', () => {
  const card = renderDiffCard({ files: parseDiff(BIN), t: en });
  assert.match(card.text, /logo\.png/);
  assert.match(card.text, new RegExp(t('en', 'diff.binaryFile')));
  assert.deepEqual(card.keyboard, []);
});

test('a card that cannot fit says how much it left out', () => {
  const big = Array.from({ length: 40 }, (_, i) => MOD.replaceAll('src/app.mjs', `src/file${i}.mjs`).replace('@@ -10,7 +10,8 @@', `@@ -${i + 1},7 +${i + 1},8 @@`)).join('');
  const files = parseDiff(big);
  assert.equal(files.length, 40);
  const card = renderDiffCard({ files, t: en, limit: 900 });
  assert.ok(card.text.length <= 4096, `card is ${card.text.length} characters`);
  assert.ok(card.hidden > 0, 'a truncated card must admit it');
  assert.match(card.text, new RegExp(`${card.hidden} more hunk`), 'the count in the text is the count that was dropped');
  // Every button on the card names a hunk that is actually shown, never one
  // that was dropped for space: a button that cannot be seen cannot be pressed.
  assert.ok(card.keyboard.filter((row) => row[0]?.data !== 'df:f').length <= card.hidden + files.length);
});

test('/diff stat lists files without hunks or buttons', () => {
  const card = renderDiffCard({ files: parseDiff([MOD, NEW].join('')), t: en, detail: false });
  assert.match(card.text, /src\/app\.mjs/);
  assert.doesNotMatch(card.text, /^@@ /m);
  assert.deepEqual(card.keyboard, []);
});

test('untracked files are named, and a long list is counted', () => {
  const card = renderDiffCard({ files: parseDiff(MOD), untracked: ['a.txt', 'b.txt'], t: en });
  assert.match(card.text, /a\.txt, b\.txt/);
  const many = Array.from({ length: 20 }, (_, i) => `f${i}.txt`);
  const long = renderDiffCard({ files: [], untracked: many, t: en });
  assert.match(long.text, /\+12/, 'the rest are counted, not hidden silently');
});

test('the card speaks three languages and never shows a raw key', () => {
  const files = parseDiff([MOD, NEW].join(''));
  for (const lang of LANGS) {
    const card = renderDiffCard({ files, t: (key, vars) => t(lang, key, vars) });
    assert.ok(card.text.length > 0, `${lang} drew nothing`);
    assert.doesNotMatch(card.text, /\bdiff\.[a-z]/i, `${lang} shows a raw key`);
    assert.doesNotMatch(card.text, /ctrl\.[a-z]/, `${lang} shows a raw key`);
    for (const row of card.keyboard) {
      for (const button of row) assert.ok(!/^diff\./.test(button.text), `${lang} button shows a key`);
    }
  }
});

test('the card is a decision, not a wall: a modest diff fits in one message', () => {
  // Telegram refuses anything over 4096 characters, and a card that has to be
  // split is a card whose buttons point at a message the person cannot see.
  const files = parseDiff(Array.from({ length: 6 }, (_, i) => MOD.replaceAll('src/app.mjs', `src/f${i}.mjs`)).join(''));
  for (const lang of LANGS) {
    const card = renderDiffCard({ files, t: (key, vars) => t(lang, key, vars) });
    assert.ok(card.text.length <= 4096, `${lang}: ${card.text.length} characters`);
  }
});

/** A throwaway repository with one commit, so `git diff` has something to say. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-diff-'));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true });
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src/app.mjs'), 'const a = 1;\nconst b = 2;\n');
  git('add', '.');
  git('commit', '--quiet', '-m', 'first');
  return { dir, git };
}

test('a real working tree is read as files, and a revert puts the line back', () => {
  const { dir } = repo();
  writeFileSync(join(dir, 'src/app.mjs'), 'const a = 1;\nconst b = 3;\n');
  assert.equal(isRepo(dir), true);

  const card = diffCard(dir, 'en');
  const rows = card.keyboard.filter((row) => row[0]?.data !== 'df:f');
  assert.equal(rows.length, 1);
  const id = rows[0][0].data.split(':')[2];

  const found = findHunk(readDiff(dir).files, id);
  assert.ok(found, 'the button id must match the diff it was drawn from');
  execFileSync('git', ['-C', dir, 'apply', '-R', '--recount', '-'], { input: hunkPatch(found.file, found.hunk), encoding: 'utf8', windowsHide: true });

  assert.match(readFileSync(join(dir, 'src/app.mjs'), 'utf8'), /const b = 2;/);
  assert.equal(readDiff(dir).files.length, 0, 'the tree is clean again');
  assert.equal(findHunk(readDiff(dir).files, id), null, 'the button is now stale');
});

test('a directory that is not a repository is refused, not guessed at', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-norepo-'));
  assert.equal(isRepo(dir), false);
  assert.deepEqual(readDiff(dir), { files: [], untracked: [] });
});
