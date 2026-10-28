// Reading the 💭 notes a turn writes with `say.mjs --thought`.
//
// Two files exist for one topic and both are written in practice:
//
//   <chat>_<thread>_<turn>.jsonl  the turn's own file, named by the bridge and
//                                 exported as DSH_TG_THOUGHT — unique per turn,
//                                 so two turns in one topic never mix;
//   <chat>_<thread>.jsonl         the stable per-topic file, used whenever the
//                                 tool shell lost the environment (it usually
//                                 does) or the agent passed explicit ids.
//
// The progress card used to read only the first, so a note written through the
// second was invisible: the 💭 block stayed empty while the file on disk kept
// growing. This module reads both and keeps only the lines that belong to the
// turn being displayed — an older line from the previous turn in the same topic
// is not this turn's progress.
import { readFileSync } from 'node:fs';

/** Every note in one file, as `{ at, text }`, oldest first. Missing file = []. */
export function readNotes(file) {
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          const row = JSON.parse(line);
          const text = String(row.text || '').trim();
          return text ? { at: Number(row.at) || 0, text: text.slice(0, 140) } : null;
        } catch { return null; }
      })
      .filter(Boolean);
  } catch { return []; }
}

/**
 * The last `limit` note texts across `files`, written at or after `since`.
 *
 * `since` is the turn's start time: it is what separates "this turn said X" from
 * "a previous turn in this topic said X". Notes without a timestamp are dropped
 * rather than shown at the wrong moment.
 */
export function recentThoughts(files, since = 0, limit = 2) {
  const seen = new Set();
  return files
    .filter(Boolean)
    .flatMap(readNotes)
    .filter((row) => row.at > 0 && row.at >= since && row.text)
    // The same note can sit in both files when `say.mjs` wrote to each; a
    // duplicated 💭 line reads as two decisions instead of one.
    .filter((row) => (seen.has(`${row.at}:${row.text}`) ? false : seen.add(`${row.at}:${row.text}`)))
    .sort((a, b) => a.at - b.at)
    .slice(-limit)
    .map((row) => row.text);
}
