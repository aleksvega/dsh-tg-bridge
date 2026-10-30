// Go back before the last N turns and try again, the way the desktop app's
// branch-from-here does.
//
// How it works, and why it is small: a session is one zstd frame per appended
// batch of records, so the tail of a turn is a run of consecutive frames. Going
// back N turns means cutting the file at the frame where that turn begins —
// nothing is rewritten, no earlier frame is touched, and every record keeps its
// original `seq`. The app appends after the last frame, so its own numbering
// stays valid and later turns keep their numbers too.
//
// What must hold before anything is cut, and is checked first:
//   - every frame decodes (a half-written frame means the session is being
//     appended to right now — refusing is better than corrupting it);
//   - the record before the cut is not a `turn/start`, which would leave a turn
//     that never ends.
// The file is never modified in place: a copy is taken, the cut is written to a
// temporary file, and only then swapped in.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import * as zlib from 'node:zlib';

// Session files are zstd frames. Node24 has the codec; anything older would fail
// here with a module error nobody can act on, so the failure names the fix.
const { zstdCompressSync, zstdDecompressSync } = zlib;
if (typeof zstdCompressSync !== 'function') {
  throw new Error('dsh-tg-bridge needs Node 24 or newer: session files are zstd-compressed');
}

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Every zstd frame start in `buf`, ascending, then the end of the buffer. */
export function frameOffsets(buf) {
  const starts = [];
  for (let at = buf.indexOf(MAGIC); at >= 0; at = buf.indexOf(MAGIC, at + MAGIC.length)) starts.push(at);
  starts.push(buf.length);
  return starts;
}

function decode(buf, from, to) {
  try {
    return zstdDecompressSync(buf.subarray(from, to)).toString('utf8');
  } catch {
    return '';
  }
}

/** Records of one frame; [] when the frame does not decode into records. */
function recordsOf(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      return [];
    }
  }
  return out;
}

function firstText(content) {
  if (!Array.isArray(content)) return '';
  for (const part of content) {
    if (part && part.type === 'text' && typeof part.text === 'string' && part.text.trim()) return part.text;
  }
  return '';
}

const textOf = (data) => firstText(data?.content) || '';

/** Every turn of the file, oldest first, with the text on both sides. */
export function allTurns(file) {
  if (!file || !existsSync(file)) return [];
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return [];
  }
  const offsets = frameOffsets(buf);
  const turns = [];
  let open = null;
  let pendingUser = '';
  for (let i = 0; i < offsets.length - 1; i++) {
    for (const record of recordsOf(decode(buf, offsets[i], offsets[i + 1]))) {
      const type = String(record.type || '');
      const data = record.data || {};
      if (type === 'user/message') {
        pendingUser = textOf(data);
        continue;
      }
      if (type === 'turn/start') {
        open = { turn: data.turn ?? turns.length + 1, user: pendingUser, answer: '', frame: i, startSeq: record.seq };
        pendingUser = '';
        turns.push(open);
        continue;
      }
      if (type === 'assistant/message' && open && !open.answer) open.answer = firstText(data.message?.content) || textOf(data);
    }
  }
  return turns;
}

/** The newest `limit` turns, newest first — what a rewind card offers. */
export function recentTurns(file, { limit = 8 } = {}) {
  const turns = allTurns(file);
  return turns.slice(-limit).reverse();
}

/** Every reason a cut can be refused. Each one has words in every language. */
const REFUSAL_REASONS = [
  'missing', 'unreadable', 'recently-written', 'tail-incomplete', 'no-turns', 'bad-steps', 'too-many-steps', 'would-leave-open-turn',
];
export { REFUSAL_REASONS };

/** How fresh a write must be for the file to count as in use. */
const RECENT_WRITE_MS = 30_000;

/**
 * Where to cut so that the last `steps` turns are gone and everything before
 * them is untouched.
 *
 * Returns `{ offset, total, kept, dropped, reason, size }`; `reason` is set when
 * no safe cut exists, and the caller must then do nothing.
 */
export function planRewind(file, steps = 1) {
  const plan = { offset: 0, total: 0, kept: 0, dropped: 0, reason: '', size: 0 };
  if (!file || !existsSync(file)) return { ...plan, reason: 'missing' };
  let buf;
  let size = 0;
  try {
    buf = readFileSync(file);
    size = statSync(file).size;
  } catch {
    return { ...plan, reason: 'unreadable' };
  }
  plan.size = size;
  // A file written in the last half minute may be held open by another process
  // (the desktop app keeps a write handle for a session it has open) even when
  // no bridge turn runs. DSH then refuses with "stored log shrank below a
  // previously observed prefix". Waiting is the honest answer.
  try {
    if (Date.now() - statSync(file).mtimeMs < RECENT_WRITE_MS) return { ...plan, reason: 'recently-written' };
  } catch {
    return { ...plan, reason: 'unreadable' };
  }
  const offsets = frameOffsets(buf);
  // A frame that does not decode is a frame being written right now, or a
  // damaged tail. Either way this file is not cut today.
  for (let i = 0; i < offsets.length - 1; i++) {
    const text = decode(buf, offsets[i], offsets[i + 1]);
    if (!text || (text.trim() && recordsOf(text).length === 0)) return { ...plan, reason: 'tail-incomplete' };
  }
  const turns = allTurns(file);
  plan.total = turns.length;
  if (turns.length === 0) return { ...plan, reason: 'no-turns' };
  if (!Number.isInteger(steps) || steps < 1) return { ...plan, reason: 'bad-steps' };
  if (steps >= turns.length) return { ...plan, reason: 'too-many-steps' };
  const keep = turns.length - steps;
  const cutFrame = turns[keep].frame;
  plan.offset = offsets[cutFrame];
  plan.kept = keep;
  plan.dropped = steps;
  const before = recordsOf(decode(buf, offsets[cutFrame - 1], offsets[cutFrame]));
  const lastRecord = before[before.length - 1];
  if (lastRecord && String(lastRecord.type) === 'turn/start') return { ...plan, reason: 'would-leave-open-turn' };
  return plan;
}

/**
 * Where to branch from: the same cut as `planRewind`, except that a fork keeps
 * everything it cuts. `steps = 0` branches from the end — a copy of the whole
 * session, which is what "continue this work down a different road" means when
 * the road starts here.
 */
export function planFork(file, steps = 0) {
  const plan = { offset: 0, total: 0, kept: 0, dropped: 0, reason: '', size: 0 };
  if (!file || !existsSync(file)) return { ...plan, reason: 'missing' };
  let buf;
  let size = 0;
  try {
    buf = readFileSync(file);
    size = statSync(file).size;
  } catch {
    return { ...plan, reason: 'unreadable' };
  }
  plan.size = size;
  // A session being appended to right now may lack its last frame; a fork taken
  // from it would copy a half-written record.
  try {
    if (Date.now() - statSync(file).mtimeMs < RECENT_WRITE_MS) return { ...plan, reason: 'recently-written' };
  } catch {
    return { ...plan, reason: 'unreadable' };
  }
  const offsets = frameOffsets(buf);
  for (let i = 0; i < offsets.length - 1; i++) {
    const text = decode(buf, offsets[i], offsets[i + 1]);
    if (!text || (text.trim() && recordsOf(text).length === 0)) return { ...plan, reason: 'tail-incomplete' };
  }
  const turns = allTurns(file);
  plan.total = turns.length;
  if (!Number.isInteger(steps) || steps < 0) return { ...plan, reason: 'bad-steps' };
  if (steps === 0) {
    plan.offset = size;
    plan.kept = turns.length;
    return plan;
  }
  if (turns.length === 0) return { ...plan, reason: 'no-turns' };
  if (steps >= turns.length) return { ...plan, reason: 'too-many-steps' };
  const keep = turns.length - steps;
  const cutFrame = turns[keep].frame;
  plan.offset = offsets[cutFrame];
  plan.kept = keep;
  plan.dropped = steps;
  const before = recordsOf(decode(buf, offsets[cutFrame - 1], offsets[cutFrame]));
  const lastRecord = before[before.length - 1];
  if (lastRecord && String(lastRecord.type) === 'turn/start') return { ...plan, reason: 'would-leave-open-turn' };
  return plan;
}

/**
 * Write a copy of the session up to `offset` as a NEW session, so the topic can
 * carry on down a different road while the original stays as it was.
 *
 * The first frame is the session header and carries the id. A copy that kept it
 * would claim to be the original — the app would see two sessions with one name
 * — so that single field is replaced and everything after it is copied byte for
 * byte, frame for frame.
 */
export function applyFork(file, offset, expectedSize) {
  const size = statSync(file).size;
  if (expectedSize !== undefined && size !== expectedSize) throw new Error(`session grew from ${expectedSize} to ${size} bytes`);
  if (!(offset > 0) || offset > size) throw new Error(`bad fork offset ${offset}`);
  const buf = readFileSync(file);
  const offsets = frameOffsets(buf);
  if (offsets.length < 2) throw new Error('session has no frames');
  const head = recordsOf(decode(buf, offsets[0], offsets[1]))[0];
  if (!head || head.type !== 'session') throw new Error('session does not start with a header');
  const id = `session-${randomUUID()}`;
  const header = Buffer.from(`${JSON.stringify({ ...head, id })}\n`, 'utf8');
  const body = buf.subarray(offsets[1], offset);
  // The session lives in <root>/<project key>/<session id>/session.v4.jsonl.zstd,
  // so its own directory parent is where a sibling session belongs.
  const self = dirname(file);
  const project = dirname(self);
  const target = join(project, id, 'session.v4.jsonl.zstd');
  mkdirSync(dirname(target), { recursive: true });
  const temp = `${target}.fork-tmp`;
  writeFileSync(temp, Buffer.concat([zstdCompressSync(header), body]));
  renameSync(temp, target);
  return { id, file: target };
}

/**
 * Cut the file at `offset`, keeping a copy of the whole file beside it. Throws
 * when the session grew between the plan and the cut — between those two
 * moments someone may have typed into the same topic, and that turn is not in
 * the plan this cut was made from.
 */
export function applyRewind(file, offset, expectedSize) {
  const size = statSync(file).size;
  if (expectedSize !== undefined && size !== expectedSize) throw new Error(`session grew from ${expectedSize} to ${size} bytes`);
  if (!(offset > 0) || offset > size) throw new Error(`bad cut offset ${offset}`);
  const backup = `${file}.rewind-backup-${stamp()}`;
  copyFileSync(file, backup);
  const temp = `${file}.rewind-tmp`;
  writeFileSync(temp, readFileSync(file).subarray(0, offset));
  renameSync(temp, file);
  return backup;
}

/** The last backup of a session and the path of the file to restore it into. */
export function newestBackup(file) {
  const cut = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  if (cut < 0) return '';
  const dir = file.slice(0, cut);
  const prefix = `${file.slice(cut + 1)}.rewind-backup-`;
  try {
    const found = readdirSync(dir).filter((name) => name.startsWith(prefix)).sort().pop();
    return found ? `${dir}${file[cut]}${found}` : '';
  } catch {
    return '';
  }
}

/** Put a backup back in place; the file it replaces is kept as `.undo-of-undo`. */
export function restoreBackup(backup, target) {
  copyFileSync(target, `${target}.undo-of-undo-${stamp()}`);
  copyFileSync(backup, target);
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
}