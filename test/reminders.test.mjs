import { test } from 'node:test';
import assert from 'node:assert/strict';

import { due, parseReminder, stampAt, upcoming } from '../work/reminders.mjs';

// A fixed local noon, so `nextClock` has no DST edge to argue about.
const NOON = new Date(2026, 9, 25, 12, 0, 0, 0).getTime();

test('relative reminders land exactly where asked', () => {
  assert.deepEqual(parseReminder('+15m tea', NOON), { at: NOON + 15 * 60_000, text: 'tea' });
  assert.deepEqual(parseReminder('+2h review the diff', NOON), { at: NOON + 2 * 3_600_000, text: 'review the diff' });
  assert.deepEqual(parseReminder('+1d back up', NOON), { at: NOON + 86_400_000, text: 'back up' });
});

test('a wall clock means the next occurrence, today or tomorrow', () => {
  assert.equal(parseReminder('18:30 call', NOON).at, new Date(2026, 9, 25, 18, 30).getTime());
  assert.equal(parseReminder('09:00 standup', NOON).at, new Date(2026, 9, 26, 9, 0).getTime());
  // A time a minute away is still today: it is not in the past.
  assert.equal(parseReminder('12:01 now', NOON).at, new Date(2026, 9, 25, 12, 1).getTime());
});

test('bad input is refused with a reason, not a guess', () => {
  assert.deepEqual(parseReminder('', NOON), { error: 'time' });
  assert.deepEqual(parseReminder('tea at noon', NOON), { error: 'time' });
  assert.deepEqual(parseReminder('25:00 late', NOON), { error: 'time' });
  assert.deepEqual(parseReminder('+10m', NOON), { error: 'text' });
  assert.deepEqual(parseReminder('+90d later', NOON), { error: 'range' });
  assert.deepEqual(parseReminder('+0m now', NOON), { error: 'range' });
});

test('the list is ordered and split by the clock', () => {
  const rows = [
    { id: 'b', at: NOON + 3_000, text: 'later' },
    { id: 'a', at: NOON - 1_000, text: 'due' },
    { id: 'c', at: NOON + 1_000, text: 'next' },
  ];
  assert.deepEqual(upcoming(rows, NOON).map((row) => row.id), ['c', 'b']);
  assert.deepEqual(due(rows, NOON).map((row) => row.id), ['a']);
  assert.deepEqual(upcoming(undefined, NOON), []);
});

test('a stamp names the day only when it is not today', () => {
  assert.equal(stampAt(new Date(2026, 9, 25, 9, 5).getTime(), NOON), '09:05');
  assert.equal(stampAt(new Date(2026, 9, 26, 9, 5).getTime(), NOON), '26.10 09:05');
});
