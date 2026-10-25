import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inlineText } from '../media-text.mjs';

const dir = mkdtempSync(join(tmpdir(), 'media-text-'));
const file = (name, body) => {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
};

test('a markdown file is pasted in full', () => {
  const path = file('notes.md', '# title\n\nbody\n');
  assert.equal(inlineText(path, 'notes.md'), '# title\n\nbody\n');
});

test('source and data extensions are accepted', () => {
  for (const name of ['a.py', 'b.csv', 'c.jsonl', 'd.yml', 'e.ps1', 'f.ts']) {
    assert.equal(inlineText(file(name, 'x'), name), 'x', name);
  }
});

test('an unknown extension stays a path', () => {
  assert.equal(inlineText(file('photo.jpg', 'binary'), 'photo.jpg'), '');
  assert.equal(inlineText(file('archive.zip', 'binary'), 'archive.zip'), '');
});

test('a name without a dot is not inlined', () => {
  assert.equal(inlineText(file('Makefile', 'all:'), 'Makefile'), '');
});

test('a long file is cut with an explicit marker', () => {
  const path = file('big.log', 'a'.repeat(100));
  const out = inlineText(path, 'big.log', 10);
  assert.equal(out, `${'a'.repeat(10)}\n… [truncated: 10 of 100 bytes]`);
});

test('a missing file yields an empty body instead of throwing', () => {
  assert.equal(inlineText(join(dir, 'nope.md'), 'nope.md'), '');
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
