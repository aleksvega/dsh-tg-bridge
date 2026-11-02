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
import { DSH_HOME } from '../core/paths.mjs';

/** Where the markers live: under `~/.dsh`, next to the thoughts they name. */
export function activeDir() {
  return join(DSH_HOME, 'tg-bridge', 'active');
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
 * Staleness is judged by the pid, not by age: a turn that runs for an hour is
 * normal, and a killed bridge leaves a marker nobody will ever clear.
 */
export function activeTargets(cwd) {
  const want = String(cwd || '').trim().toLowerCase();
  if (!want) return [];
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
      if (!alive(record.pid)) {
        clearActive(record.pid);
        continue;
      }
      found.push(record);
    } catch {}
  }
  return found;
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
