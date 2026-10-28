// One command, one answer — across a restart too.
//
// `/update confirm` on 1.22.0 installed the release, then threw on an undefined
// name. The update was never acked, so it stayed in the journal; each restart
// replayed it, it threw again, and the chat got "already on 1.22.0" three times
// for one typed command. Two rules came out of it:
//
//   • a command that throws is still answered (one line, then ack) — silence
//     reads as "still working", and an unacked update is a replay waiting to
//     happen;
//   • a replayed turn gets exactly one retry, then it is acked even if it failed,
//     so a permanently broken update cannot become a restart-long loop.
//
// bridge.mjs starts polling the moment it is loaded and cannot be imported, so
// these assertions read the source — the same way the callback allowlist guard
// is asserted where it lives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../bridge.mjs', import.meta.url), 'utf8');

/** Source between two markers, so an assertion cannot match another branch. */
function between(start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `bridge.mjs no longer contains: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `bridge.mjs no longer contains "${end}" after "${start}"`);
  return source.slice(from, to);
}

test('a command that throws is answered and acked, not left for a replay', () => {
  const branch = between("if (immediate) {", 'enqueue(');
  assert.match(branch, /log\(`command \$\{immediate\} failed/, 'the failure names the command');
  assert.match(branch, /msg\.commandFailed/, 'the person is told it failed instead of hearing nothing');
  assert.match(branch, /ack\(update\.update_id\)/, 'and the update is acked, so no restart replays it');
  // The ack must sit in the failure path, not only in the success path: that
  // difference is the whole bug.
  const failure = branch.slice(branch.indexOf('.catch('));
  assert.match(failure, /ack\(update\.update_id\)/, 'the ack is inside the catch');
});

test('a replayed turn gets one retry, then it is acked either way', () => {
  const queued = between('turn error for update', 'Only plain text prompts');
  assert.match(queued, /if \(replay\) ack\(update\.update_id\)/, 'a failed replay is acked instead of retried on every start');
  assert.match(queued, /already a retry, dropping/, 'and the log says the entry was dropped, not lost');
});

test('the replay loop acks an entry that throws while being replayed', () => {
  const loop = between('for (const { update } of fresh)', 'let pollFailures');
  assert.match(loop, /catch \(error\)/, 'the loop guards each entry');
  assert.match(loop, /ack\(update\?\.update_id\)/, 'a bad entry is acked so it cannot become a restart loop');
});

test('a stale journal entry is dropped, not replayed as a fresh turn', () => {
  // After a bad release left nineteen updates unacked, the next start would
  // have re-run an evening of turns the owner had already read. A replay is for
  // what was mid-flight; an hour-old command replayed is a second install, a
  // second charge and an answer out of context.
  const loop = between('const owed = pendingUpdates()', 'let pollFailures');
  assert.match(loop, /replayWindowMs/, 'the window is a setting, not a magic number in the loop');
  assert.match(loop, /now - at > replayWindowMs/, 'age decides what is replayed');
  assert.match(loop, /dropping \$\{stale\.length\} pending/, 'the drop is logged, not silent');
  assert.match(loop, /for \(const \{ id \} of stale\) ack\(id\)/, 'a dropped entry is acked, so it cannot come back');
});

test('the journal is still written before the turn and cleared after it', () => {
  // The ack rule above must not weaken the crash guarantee: a turn is still
  // owed an answer until it produced one.
  assert.match(source, /writePending\(update\)/, 'the update is journaled before processing');
  assert.ok(
    source.indexOf('writePending(update)') < source.indexOf('accept(update)'),
    'the journal write happens before the update is handled',
  );
});
