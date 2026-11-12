// Which turn is running in which folder, in a place a tool shell can read.
//
// A turn's tools inherit the bridge's environment in theory, but a shell that
// lost it cannot place a 💭 line: `say.mjs` refuses to guess the topic, and
// guessing is right — two topics run at once and the loser posts into a
// stranger's chat. What is missing is a fact, not a heuristic: the bridge knows
// the key it spawned, and it can write that down where reading is always
// allowed.
//
// One file per process, named by pid, so two turns never overwrite each other.
// The reader picks the entry whose folder matches its own `cwd` and refuses when
// zero or two match: an ambiguous answer is the one thing worse than none.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIR } from '../core/paths.mjs';

/**
 * Where the markers live: next to the thoughts they name.
 *
 * Under `DIR`, not a fixed `~/.dsh/tg-bridge`: a second bridge instance (the
 * adviser bot) has its own state folder, and both bots run turns in the same
 * workspace. Sharing one marker folder made each of them see two live turns in
 * that folder and refuse to place a 💭 line at all.
 */
export function activeDir() {
  return join(DIR, 'active');
}

/**
 * Record a turn as running: its topic, its folder and its note file.
 *
 * Returns the path, or '' when the write fails — a turn must not fail because a
 * bookkeeping file could not be written, and the old env path still works.
 */
export function markActive({ pid, key, chatId, threadId, cwd, thought }) {
  try {
    mkdirSync(activeDir(), { recursive: true });
    sweep();
    const path = join(activeDir(), `${pid}.json`);
    const record = {
      pid,
      key: String(key || ''),
      chatId: Number(chatId || 0),
      threadId: Number(threadId || 0),
      cwd: String(cwd || ''),
      thought: String(thought || ''),
      at: Date.now(),
    };
    writeFileSync(path, JSON.stringify(record), 'utf8');
    return path;
  } catch {
    return '';
  }
}

/** Forget a turn. A marker left behind would point the next shell at a dead one. */
export function clearActive(pid) {
  try {
    rmSync(join(activeDir(), `${pid}.json`), { force: true });
  } catch {}
}

/**
 * Live markers for one folder, ignoring files whose process is gone.
 *
 * The whole folder is swept first, not just the entries this folder would use:
 * a marker from another folder is still a marker nobody clears. Eight of them
 * had piled up in one bot's folder before anyone looked.
 */
export function activeTargets(cwd) {
  const want = String(cwd || '').trim().toLowerCase();
  if (!want) return [];
  sweep();
  let names = [];
  try {
    names = readdirSync(activeDir()).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const found = [];
  for (const name of names) {
    try {
      const record = JSON.parse(readFileSync(join(activeDir(), name), 'utf8'));
      if (!record?.chatId) continue;
      if (String(record.cwd || '').trim().toLowerCase() !== want) continue;
      found.push(record);
    } catch {}
  }
  return found;
}

/**
 * Drop every marker whose turn is over. A handful of small files, so: on read.
 *
 * Deletes the file it read, not the file its pid names: the two are the same
 * until one of them is wrong, and then the sweep would take a live turn with it.
 */
export function sweep() {
  let names = [];
  try {
    names = readdirSync(activeDir()).filter((name) => name.endsWith('.json'));
  } catch {
    return;
  }
  for (const name of names) {
    let record = null;
    try {
      record = JSON.parse(readFileSync(join(activeDir(), name), 'utf8'));
    } catch {}
    if (record && !stale(record)) continue;
    try {
      rmSync(join(activeDir(), name), { force: true });
    } catch {}
  }
}

/**
 * Is this marker from a turn that is over?
 *
 * Two ways to be over: the process is gone, or the file is older than any turn
 * could be. The age limit is not about long turns — it is about pid reuse.
 * Windows hands the same number out again, and a marker from yesterday then
 * looks alive because a browser now owns that pid.
 */
const MAX_TURN_MS = 12 * 60 * 60 * 1000;

function stale(record) {
  const at = Number(record?.at || 0);
  if (at > 0 && Date.now() - at > MAX_TURN_MS) return true;
  return !alive(record?.pid);
}

/** Is that process still there? A shell cannot see a child it did not start. */
function alive(pid) {
  const id = Number(pid);
  if (!Number.isInteger(id) || id <= 0) return false;
  try {
    process.kill(id, 0);
    return true;
  } catch (error) {
    // EPERM means it exists and belongs to someone else: the pid is alive.
    return error?.code === 'EPERM';
  }
}
