// `/status` parsed the whole session log on every press: 27 MB, 19,727 zstd
// frames, 12 s of synchronous work before the card could be sent, and `/cost`
// paid it again. The numbers only ever grow, so the card may keep them -- but a
// cache that outlives the file it describes is worse than the wait it removes.
// These tests hold both ends: an unchanged log must not be read again, and a
// changed one must read exactly as a cold parse would.
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { zstdCompressSync } from 'node:zlib';

import { sessionStats } from '../chat/thoughts.mjs';

const dir = mkdtempSync(join(tmpdir(), 'dsh-stats-'));

// One argument is one record; an array is one frame of records. The log appends
// a frame per batch, which is what lets a parse resume at a frame boundary.
function log(records) {
  const batches = records.map((r) => (Array.isArray(r) ? r : [r]));
  return Buffer.concat(batches.map((batch) => zstdCompressSync(Buffer.from(`${batch.map((r) => JSON.stringify(r)).join('\n')}\n`))));
}

const session = { type: 'session', createdAt: 1000, time: 1000 };
const turn = (n, tokens = 100) => [
  { type: 'turn/start', time: 2000 + n },
  {
    type: 'assistant/message',
    time: 2001 + n,
    data: { message: { model: 'm-one' }, usage: { totalTokens: tokens, inputTokens: 10, outputTokens: 5, cacheReadTokens: 1 } },
  },
];

function write(name, buf) {
  const file = join(dir, name);
  writeFileSync(file, buf);
  return file;
}

test('an unchanged log is answered from memory, not read again', () => {
  // Pin the modification time to a whole second so it can be put back exactly:
  // a fraction of a millisecond would make the second press a different file.
  const whole = new Date(Math.floor(Date.now() / 1000) * 1000);
  const file = write('unchanged.zstd', log([session, turn(1)]));
  utimesSync(file, whole, whole);

  const first = sessionStats(file);
  assert.equal(first.turns, 1);
  assert.equal(first.lifetimeTokens, 16);

  // Same length, same mtime, unparsable content: only a press that does not read
  // the file at all can still answer with the numbers above.
  writeFileSync(file, Buffer.alloc(statSync(file).size, 0));
  utimesSync(file, whole, whole);

  assert.deepEqual(sessionStats(file), first, 'the second press re-read a file that had not changed');
});

test('a grown log resumes at the last parsed frame and agrees with a cold parse', () => {
  const file = write('grown.zstd', log([session, turn(1)]));
  const before = sessionStats(file);

  const all = log([session, turn(1), turn(2, 200)]);
  writeFileSync(file, all);
  const warm = sessionStats(file);

  // The same bytes under a path nobody has parsed: a full parse of the whole log.
  const cold = sessionStats(write('grown-cold.zstd', all));

  assert.deepEqual(warm, cold, 'resuming from a prefix disagreed with reading the file from the start');
  assert.equal(warm.turns, 2);
  assert.ok(warm.lifetimeTokens > before.lifetimeTokens);
});

test('a rewritten log is parsed from zero, never resumed from a stale prefix', () => {
  const file = write('rewritten.zstd', log([session, turn(1), turn(2), turn(3)]));
  sessionStats(file);

  // Shorter and different: a compacted log, or another session under this path.
  const replacement = log([{ type: 'session', createdAt: 5000, time: 5000 }, turn(9, 7)]);
  writeFileSync(file, replacement);
  const after = sessionStats(file);

  assert.deepEqual(after, sessionStats(write('rewritten-cold.zstd', replacement)));
  assert.equal(after.turns, 1, 'a truncated log must not keep the old turn count');
  assert.equal(after.createdAt, 5000);
});

test('a missing or unreadable path is still the empty answer, not a crash', () => {
  assert.equal(sessionStats(join(dir, 'never-written.zstd')).turns, 0);
  assert.equal(sessionStats('').turns, 0);
  assert.equal(sessionStats(undefined).turns, 0);
});