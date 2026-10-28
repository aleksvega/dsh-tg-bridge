// The 💭 lines of the progress card come from two files that `say.mjs` writes
// to depending on whether the tool shell kept the bridge's environment. Reading
// only one of them is what made the block stay empty for a whole session while
// the file on disk kept growing, so both paths are covered here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNotes, recentThoughts } from '../notes.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dsh-notes-'));

function notesFile(name, rows) {
  const file = join(dir, name);
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');
  return file;
}

test('a note is read back with its time and text', () => {
  const file = notesFile('a.jsonl', [{ at: 1000, text: 'first' }, { at: 2000, text: 'second' }]);
  assert.deepEqual(readNotes(file), [{ at: 1000, text: 'first' }, { at: 2000, text: 'second' }]);
});

test('a missing file is an empty list, not a throw', () => {
  assert.deepEqual(readNotes(join(dir, 'nope.jsonl')), []);
});

test('a torn line (the agent is writing right now) is skipped', () => {
  const file = join(dir, 'torn.jsonl');
  writeFileSync(file, '{"at":1,"text":"ok"}\n{"at":2,"te', 'utf8');
  assert.deepEqual(readNotes(file), [{ at: 1, text: 'ok' }]);
});

test('notes from the turn file and the topic file both reach the card', () => {
  const turn = notesFile('turn.jsonl', [{ at: 5000, text: 'from the turn file' }]);
  const topic = notesFile('topic.jsonl', [{ at: 6000, text: 'from the topic file' }]);
  assert.deepEqual(recentThoughts([turn, topic], 0), ['from the turn file', 'from the topic file']);
});

test('a note from an earlier turn in the same topic is not shown', () => {
  const topic = notesFile('old.jsonl', [
    { at: 1000, text: 'previous turn' },
    { at: 9000, text: 'this turn' },
  ]);
  assert.deepEqual(recentThoughts([topic], 5000), ['this turn']);
});

test('only the last two notes are kept, oldest first', () => {
  const file = notesFile('three.jsonl', [
    { at: 1, text: 'one' }, { at: 2, text: 'two' }, { at: 3, text: 'three' },
  ]);
  assert.deepEqual(recentThoughts([file], 0), ['two', 'three']);
});

test('the same note in both files is shown once', () => {
  const row = { at: 7000, text: 'same line' };
  const turn = notesFile('dup-a.jsonl', [row]);
  const topic = notesFile('dup-b.jsonl', [row]);
  assert.deepEqual(recentThoughts([turn, topic], 0), ['same line']);
});

test('a note without a timestamp is dropped instead of shown at the wrong time', () => {
  const file = notesFile('noat.jsonl', [{ text: 'undated' }, { at: 42, text: 'dated' }]);
  assert.deepEqual(recentThoughts([file], 0), ['dated']);
});
