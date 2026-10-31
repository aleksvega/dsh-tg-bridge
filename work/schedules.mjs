// Repeating schedules (`/every`), stored and fired by the bridge.
//
// Same reasoning as reminders: a Telegram turn is one short-lived process, so
// the bridge is the only piece that lives long enough to keep a clock.
//
// The one rule this module exists to protect is "exactly one firing per
// occurrence". A tick claims a row by moving its `at` to the next occurrence in
// the same `saveState()` that the caller persists; delivery happens afterwards.
// A crash between the two loses one firing — never duplicates it, never replays
// missed days one message per day.

import { nextClock, parseReminder } from './reminders.mjs';

/** Per-chat cap, the same order as the reminders' 20. */
export const MAX = 20;

/**
 * Parse what follows `/every`: a wall clock and the text to deliver.
 *
 * Only `HH:MM` is accepted. `parseReminder` also takes `+15m`, which for a
 * repeating schedule would mean "every 15 minutes from now" — a meaning nobody
 * asked for, and one that would silently turn a daily note into a flood.
 *
 * @returns {{ at: number, hh: number, mm: number, text: string } | { error: 'time' | 'text' | 'range' }}
 */
export function parseEvery(input, now = Date.now()) {
  const source = String(input || '').trim();
  // The clock form only. Checked before parseReminder so a relative delay is a
  // plain "I cannot read the time" instead of a daily schedule at a random hour.
  if (!/^\d{1,2}:\d{2}\b/.test(source)) return { error: 'time' };
  const parsed = parseReminder(source, now);
  if (parsed.error) return parsed;
  const when = new Date(parsed.at);
  return { at: parsed.at, hh: when.getHours(), mm: when.getMinutes(), text: parsed.text };
}

/**
 * The next occurrence strictly after `now`, from the wall clock.
 *
 * Never `at + 86_400_000`: after a DST change that drifts by an hour and the
 * schedule fires at a time nobody picked. A row that missed several days lands
 * on the next future occurrence directly, so catch-up is one firing, not a
 * burst of one per missed day.
 */
export function nextAt(row, now = Date.now()) {
  const fallback = new Date(Number(row?.at) || now);
  const hh = Number.isInteger(row?.hh) ? row.hh : fallback.getHours();
  const mm = Number.isInteger(row?.mm) ? row.mm : fallback.getMinutes();
  return nextClock(hh, mm, now);
}

/**
 * Split rows into "still waiting" and "due now", advancing the due ones.
 *
 * Pure: the caller gets a new array and new row copies, then persists it. That
 * keeps the claim and the save in one place and makes the advance testable
 * without a clock or a Telegram stub.
 */
export function claimRows(rows, now = Date.now()) {
  const claimed = [];
  const next = (Array.isArray(rows) ? rows : []).map((row) => {
    if (!row || !(Number(row.at) <= now)) return row;
    const claimedRow = { ...row, at: nextAt(row, now) };
    claimed.push(claimedRow);
    return claimedRow;
  });
  return { rows: next, claimed };
}

/**
 * This chat's schedules, soonest first.
 *
 * Every topic of the chat, because the cap is per chat (like the reminders'
 * twenty) and `/every list` answers for the chat: a list that only showed the
 * topic it was typed in would let a person fill the chat up while every answer
 * said there was room. A row that fires into a topic names it.
 */
export function chatOf(rows, chatId) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && String(row.chatId) === String(chatId))
    .sort((a, b) => a.at - b.at);
}

/**
 * The message the bridge feeds back into its own handler.
 *
 * A schedule must arrive as a real turn — the agent has to act on "check the
 * build", not read a notification about it — so this mimics an incoming text
 * from the owner closely enough for the normal path to accept it. `from` must be
 * the numeric owner id: the allowlist compares with `includes`, so a string
 * would be silently refused and the schedule would never fire.
 *
 * Two fields are deliberately absent. `message_id` is 0 because there is no
 * Telegram message behind it, and every caller that anchors on one already
 * guards for 0. `is_topic_message` stays false because the handler treats it as
 * "this thread has never been seeded" and would post the schedule text a second
 * time, with a General log line, into a topic that someone created by hand.
 */
export function syntheticMessage(row, ownerId) {
  const threadId = Number(row?.threadId) || 0;
  return {
    chat: { id: Number(row.chatId) },
    from: { id: Number(ownerId) },
    message_id: 0,
    message_thread_id: threadId || undefined,
    text: String(row.text ?? ''),
  };
}