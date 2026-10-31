// Reminders belong to the bridge, not to DSH's schedule service.
//
// The schedule service drives a Host that stays alive and fires a turn by
// itself; a Telegram turn is one short-lived process, so a schedule created
// inside it dies with the process. The bridge is the only long-lived piece
// here, so it owns both the store and the delivery.

const MAX_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The next time a wall clock shows `hh:mm`, local time.
 *
 * Exported because `/every` needs the same answer: a repeating schedule that
 * added 86 400 000 ms per day would drift by an hour after a DST change and fire
 * at a time nobody picked.
 */
export function nextClock(hh, mm, now) {
  const at = new Date(now);
  at.setHours(hh, mm, 0, 0);
  if (at.getTime() <= now + 30_000) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/**
 * Parse the time expression a person types after `/remind`.
 * Accepts `+15m`, `+2h`, `+1d` and a wall clock `09:30` (next occurrence).
 * @returns {{ at: number, text: string } | { error: 'time' | 'text' | 'range' }}
 */
export function parseReminder(input, now = Date.now()) {
  const source = String(input || '').trim();
  if (!source) return { error: 'time' };
  let at = 0;
  let rest = '';
  const relative = /^\+(\d{1,3})\s*([mhd])\b\s*/i.exec(source);
  const clock = /^(\d{1,2}):(\d{2})\b\s*/.exec(source);
  if (relative) {
    const amount = Number(relative[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2].toLowerCase()];
    at = now + amount;
    rest = source.slice(relative[0].length);
  } else if (clock) {
    const hh = Number(clock[1]);
    const mm = Number(clock[2]);
    if (hh > 23 || mm > 59) return { error: 'time' };
    at = nextClock(hh, mm, now);
    rest = source.slice(clock[0].length);
  } else {
    return { error: 'time' };
  }
  const text = rest.trim();
  if (!text) return { error: 'text' };
  if (at - now > MAX_AHEAD_MS) return { error: 'range' };
  if (at <= now) return { error: 'range' };
  return { at, text: text.slice(0, 500) };
}

/** Upcoming reminders, soonest first. */
export function upcoming(reminders, now = Date.now()) {
  return (Array.isArray(reminders) ? reminders : [])
    .filter((row) => row && Number(row.at) > now)
    .sort((a, b) => a.at - b.at);
}

/** The ones that are due, soonest first. */
export function due(reminders, now = Date.now()) {
  return (Array.isArray(reminders) ? reminders : [])
    .filter((row) => row && Number(row.at) <= now)
    .sort((a, b) => a.at - b.at);
}

/** `14:05`, or `24.10 14:05` when the day differs from `now`. */
export function stampAt(at, now = Date.now()) {
  const when = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  const clock = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  const today = new Date(now);
  if (when.toDateString() === today.toDateString()) return clock;
  return `${pad(when.getDate())}.${pad(when.getMonth() + 1)} ${clock}`;
}
