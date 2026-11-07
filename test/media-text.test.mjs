import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inlineText } from '../chat/media-text.mjs';

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

test('the default excerpt stays far under the command-line budget', () => {
  // The inline body lands in the task on the argv, and Windows cuts a command
  // line at 32 767 chars: two 60 000-char excerpts once killed the turn at
  // spawn. The default must stay well inside that, truncation marker included.
  const body = inlineText(file('huge.txt', 'x'.repeat(200_000)), 'huge.txt');
  assert.ok(body.length < 24_000, `inline body is ${body.length}`);
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
