// A decision line the person reads mid-turn must never look like it stopped
// mid-thought.
//
// The 💭 trail is written by the agent and read back from a file, and the reader
// used to cut every line at 140 characters with `slice` — no ellipsis, no word
// boundary. A line one character too long arrived as "…при провале — от", which
// reads as a bug in the bridge rather than as a shortened sentence, and the chat
// message (sent separately) showed a *different* fragment because it went through
// the same cut at a different length. Both are covered here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clipNote, readNotes, thoughtRows } from '../chat/notes.mjs';

test('a short line is returned untouched', () => {
  assert.equal(clipNote('Проверяю откат на стабильную версию'), 'Проверяю откат на стабильную версию');
});

test('a long line is cut at a word boundary and marked', () => {
  const line = 'Статическая проверка ловит импорты но не ReferenceError внутри функции и нужен пост-фактум чтобы версия проверялась живым ходом';
  const out = clipNote(line, 60);
  assert.ok(out.length <= 60, `still too long: ${out.length}`);
  assert.ok(out.endsWith('…'), 'a shortened line must say it was shortened');
  // The character before the ellipsis is a letter, not the middle of a word.
  const stem = out.slice(0, -1);
  assert.ok(line.startsWith(stem), 'the cut must not rewrite the text');
  assert.ok(/[\p{L}\p{N}]$/u.test(stem), 'the cut landed on punctuation or space');
  const next = line[stem.length];
  assert.ok(next === undefined || /\s/.test(next), `cut mid-word: "…${stem.slice(-8)}|${next}"`);
});

test('a line with no spaces is still bounded', () => {
  // A single long token has no word boundary to respect: a hard cut with the
  // ellipsis is the only honest option, and it must not exceed the budget.
  const out = clipNote('a'.repeat(500), 50);
  assert.equal(out.length, 50);
  assert.ok(out.endsWith('…'));
});

test('the default budget leaves a real sentence readable', () => {
  const line = 'Откат к стабильной версии: помечаю версию проверенной только после того, как ход ответил, иначе откатываюсь на последнюю проверенную';
  const out = clipNote(line);
  assert.ok(out.length > 40, 'the default must not mangle an ordinary line');
  assert.ok(out.length <= 300);
});

test('reading a file clips every line the same way, and keeps the timestamps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notes-'));
  const file = join(dir, '1_0_9.jsonl');
  const long = `${'слово '.repeat(120)}конец`;
  writeFileSync(file, [
    JSON.stringify({ at: 1000, text: 'короткая' }),
    JSON.stringify({ at: 2000, text: long }),
    JSON.stringify({ at: 3000, text: '   ' }),
  ].join('\n'), 'utf8');
  const rows = readNotes(file);
  assert.equal(rows.length, 2, 'a blank line is not a note');
  assert.equal(rows[0].text, 'короткая');
  assert.equal(rows[1].at, 2000);
  assert.ok(rows[1].text.endsWith('…'), 'the long line must be marked as shortened');
  assert.ok(!rows[1].text.includes('\u0000'));
});

test('the card and the chat message see the same text', () => {
  // Both read through `thoughtRows`, so a shortened line is shortened once and
  // identically: the 💭 in the card and the 💭 sent as its own message agree.
  const dir = mkdtempSync(join(tmpdir(), 'notes-'));
  const file = join(dir, '1_0_9.jsonl');
  const long = `${'решение '.repeat(80)}конец`;
  writeFileSync(file, JSON.stringify({ at: 5000, text: long }) + '\n', 'utf8');
  const rows = thoughtRows([file], 0);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].text.endsWith('…'));
  assert.equal(rows[0].text, clipNote(long));
});

test('a note older than the turn is not shown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notes-'));
  const file = join(dir, '1_0_9.jsonl');
  writeFileSync(file, [
    JSON.stringify({ at: 100, text: 'прошлый ход' }),
    JSON.stringify({ at: 900, text: 'этот ход' }),
  ].join('\n'), 'utf8');
  assert.deepEqual(thoughtRows([file], 500).map((row) => row.text), ['этот ход']);
});

test('the same note in both files appears once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'notes-'));
  const a = join(dir, 'a.jsonl');
  const b = join(dir, 'b.jsonl');
  const line = JSON.stringify({ at: 700, text: 'одно решение' });
  writeFileSync(a, `${line}\n`, 'utf8');
  writeFileSync(b, `${line}\n`, 'utf8');
  assert.equal(thoughtRows([a, b], 0).length, 1);
});
