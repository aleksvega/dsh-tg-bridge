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
 * Every note of this turn across `files`, oldest first, de-duplicated.
 *
 * The chat forwarder needs the whole list, not the last two the card shows: a
 * step that only ever reached a card the person was not looking at is a step
 * they never learned about.
 */
export function thoughtRows(files, since = 0) {
  const seen = new Set();
  return files
    .filter(Boolean)
    .flatMap(readNotes)
    .filter((row) => row.at > 0 && row.at >= since && row.text)
    // The same note can sit in both files when `say.mjs` wrote to each; a
    // duplicated 💭 line reads as two decisions instead of one.
    .filter((row) => (seen.has(`${row.at}:${row.text}`) ? false : seen.add(`${row.at}:${row.text}`)))
    .sort((a, b) => a.at - b.at);
}

/**
 * How much of the decision trail this topic wants: `off`, `card` or `chat`.
 *
 * Three ends, one switch — the trail is one job, and a second command for "send
 * them to the chat" would be the lookalike name this surface spent a release
 * removing. `card` is the default: the last two lines inside the progress
 * message. `chat` also sends each line as its own message, for a turn a person
 * wants to read while it runs instead of afterwards.
 *
 * An old `true`/`false` in `state.json` is still a mode: `card`/`off`. It is
 * what the previous release stored, and a settings file must not need editing
 * by hand after an update.
 */
export function reasoningMode(state, config, key = '') {
  const raw = state?.reasoning?.[key];
  const fromTopic = raw === 'chat' || raw === 'card' || raw === 'off' ? raw : raw === true ? 'card' : raw === false ? 'off' : '';
  if (fromTopic) return fromTopic;
  const fallback = config?.reasoning;
  if (fallback === 'chat' || fallback === 'card' || fallback === 'off') return fallback;
  if (fallback === false) return 'off';
  return 'card';
}

/**
 * The last `limit` note texts across `files`, written at or after `since`.
 *
 * `since` is the turn's start time: it is what separates "this turn said X" from
 * "a previous turn in this topic said X". Notes without a timestamp are dropped
 * rather than shown at the wrong moment.
 */
export function recentThoughts(files, since = 0, limit = 2) {
  return thoughtRows(files, since).slice(-limit).map((row) => row.text);
}
