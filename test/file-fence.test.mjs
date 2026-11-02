// The fence in front of every file the chat reads, and the search behind /find.
//
// Both were written after a real cost: a walk that read everything froze a turn,
// and a search that silently gave up looked exactly like "nothing matches".
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MAX_BYTES, looksText, readTextFile, resolveInRoot, walkFiles } from '../lib/file-fence.mjs';
import { findInFiles } from '../control/cmd-find.mjs';

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'fence-'));
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

test('the fence accepts a path inside the folder and refuses one outside', () => {
  const root = tree({ 'a/b.txt': 'hello\n' });
  assert.equal(resolveInRoot(root, 'a/b.txt').path, join(root, 'a/b.txt'));
  assert.equal(resolveInRoot(root, '../elsewhere.txt').refusal, 'outside');
  assert.equal(resolveInRoot(root, '/etc/passwd').refusal === 'outside' || process.platform === 'win32', true);
  assert.equal(resolveInRoot(root, 'missing.txt').refusal, 'missing');
  assert.equal(resolveInRoot('', 'a').refusal, 'empty');
});

test('a binary and a huge file are refused with a reason', () => {
  const root = tree({ 'bin.dat': Buffer.from([0x50, 0x00, 0x51]), 'big.txt': 'x'.repeat(MAX_BYTES + 1) });
  assert.equal(readTextFile(join(root, 'bin.dat')).refusal, 'binary');
  assert.equal(readTextFile(join(root, 'big.txt')).refusal, 'large');
  assert.equal(readTextFile(join(root, 'nope.txt')).refusal, 'missing');
  assert.equal(readTextFile(root).refusal, 'dir');
});

test('a text file with an accent or a cyrillic letter is still text', () => {
  assert.equal(looksText(Buffer.from('привет, мир\n')), true);
  assert.equal(looksText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00])), false);
});

test('the walk says when it stopped instead of pretending it finished', () => {
  const files = {};
  for (let n = 0; n < 30; n += 1) files[`src/f${n}.txt`] = 'x';
  const root = tree(files);
  const full = walkFiles(root);
  assert.equal(full.stopped, false);
  assert.equal(full.files.length, 30);
  const cut = walkFiles(root, { files: 5, ms: 5000, depth: 8 });
  assert.equal(cut.stopped, true);
  assert.equal(cut.files.length, 5);
});

test('ignored folders are not walked at all', () => {
  const root = tree({ 'src/a.txt': 'x', 'node_modules/pkg/b.txt': 'x', '.git/c.txt': 'x' });
  const walked = walkFiles(root);
  assert.equal(walked.files.length, 1);
  assert.match(walked.files[0], /a\.txt$/);
});

test('a matching line is found with its number', () => {
  const root = tree({ 'README.md': 'one\ntwo v1.38 three\nfour\n' });
  const found = findInFiles(root, 'v1.38');
  assert.equal(found.found, 1);
  assert.equal(found.hits[0].line, 2);
  assert.equal(found.hits[0].text, 'two v1.38 three');
});

test('a query with regex characters is searched literally', () => {
  const root = tree({ 'a.txt': 'value (x).*\nother\n' });
  const found = findInFiles(root, '(x).*');
  assert.equal(found.found, 1);
  assert.equal(findInFiles(root, '.*').found, 1);
});

test('no match is an answer, and skipped files are counted', () => {
  const root = tree({ 'a.txt': 'nothing here\n', 'b.bin': Buffer.from([0x00, 0x01]) });
  const none = findInFiles(root, 'absent');
  assert.equal(none.found, 0);
  assert.equal(none.hits.length, 0);
  const found = findInFiles(root, 'nothing');
  assert.equal(found.found, 1);
  assert.equal(found.skipped, 1);
});

test('more matches than the cap are counted, not truncated silently', () => {
  const root = tree({ 'a.txt': `${'hit\n'.repeat(50)}` });
  const found = findInFiles(root, 'hit', { cap: 20 });
  assert.equal(found.hits.length, 20);
  assert.equal(found.found, 50);
});