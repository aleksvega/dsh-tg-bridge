// What the bridge remembers between turns: config, state.json, the log, and the
// update journal.
//
// The journal is the part that matters. A restart used to swallow whatever
// message was mid-flight: `offset` advanced before the turn ran, so nothing ever
// replayed it. An update is written here BEFORE the offset moves and deleted
// only after the answer reached Telegram — the one order that survives a crash.
import { appendFileSync, existsSync, mkdirSync, openSync, fsyncSync, closeSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync as writeFd } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { DONE_FILE, DONE_TTL_MS, DIR, HOME, LOG, PENDING_DIR, STATE } from './paths.mjs';

export const config = {
  allowedUserIds: [],
  profile: 'headless',
  cwd: join(HOME, 'Documents', 'deepseek-harness', 'default-workspace'),
  turnTimeoutMs: 20 * 60 * 1000,
};
try {
  Object.assign(config, JSON.parse(readFileSync(join(DIR, 'config.json'), 'utf8')));
} catch {}
// Old installs wrote these paths relative to the bridge directory, but turns
// run from the project cwd, where "./transcribe.py" does not exist. Resolve
// once at load so voice and vision work regardless of the topic's directory.
if (config.voice?.script && !isAbsolute(config.voice.script)) config.voice.script = join(DIR, config.voice.script);
if (config.vision?.patch && !isAbsolute(config.vision.patch)) config.vision.patch = join(DIR, config.vision.patch);

export const state = (() => {
  if (!existsSync(STATE)) return { offset: 0, sessions: {} };
  try {
    // Strip a UTF-8 BOM: PowerShell's Set-Content adds one and JSON.parse rejects it.
    return JSON.parse(readFileSync(STATE, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return { offset: 0, sessions: {} };
  }
})();

/** Atomic write: temp file, fsync, rename — a torn state.json loses sessions. */
export function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w');
  try {
    writeFd(fd, text, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

export function saveState() {
  writeAtomic(STATE, JSON.stringify(state, null, 2));
}

export function log(line) {
  const text = `${new Date().toISOString()} ${line}\n`;
  try { appendFileSync(LOG, text, 'utf8'); } catch {}
  process.stdout.write(text);
}

/** update ids already answered, persisted, TTL-bound. */
export const done = (() => {
  try {
    const raw = JSON.parse(readFileSync(DONE_FILE, 'utf8'));
    const cutoff = Date.now() - DONE_TTL_MS;
    return new Map(Object.entries(raw).filter(([, at]) => Number(at) > cutoff));
  } catch {
    return new Map();
  }
})();

export function saveDone() {
  try {
    writeAtomic(DONE_FILE, JSON.stringify(Object.fromEntries(done), null, 0));
  } catch (error) {
    log(`done.json write failed: ${error.message}`);
  }
}

/**
 * Write config.json back.
 *
 * Only for a setting the owner changed from the chat: `config` is the live
 * object every module reads, so mutating it first and persisting second means a
 * failed write costs the restart, not the current setting. Re-reads the file so
 * keys written by hand (tokens, profiles) are not dropped by a stale copy.
 */
export function saveConfig() {
  try {
    let onDisk = {};
    try {
      onDisk = JSON.parse(readFileSync(join(DIR, 'config.json'), 'utf8').replace(/^\uFEFF/, ''));
    } catch {}
    writeAtomic(join(DIR, 'config.json'), `${JSON.stringify({ ...onDisk, ...config }, null, 2)}\n`);
    return true;
  } catch (error) {
    log(`config.json write failed: ${error.message}`);
    return false;
  }
}

export function pendingPath(updateId) {
  return join(PENDING_DIR, `${updateId}.json`);
}

/** Persist one update before it is processed. */
export function writePending(update) {
  try {
    mkdirSync(PENDING_DIR, { recursive: true });
    writeAtomic(pendingPath(update.update_id), JSON.stringify(update));
    return true;
  } catch (error) {
    log(`pending write failed for ${update.update_id}: ${error.message}`);
    return false;
  }
}

/** Mark answered: remember the id and drop the file. Called AFTER the send. */
export function ack(updateId) {
  done.set(String(updateId), Date.now());
  saveDone();
  try {
    unlinkSync(pendingPath(updateId));
  } catch {}
}

/** Ids of pending updates still owed an answer, oldest first. */
export function pendingUpdates() {
  try {
    mkdirSync(PENDING_DIR, { recursive: true });
    const cutoff = Date.now() - DONE_TTL_MS;
    const out = [];
    for (const file of readdirSync(PENDING_DIR)) {
      if (!file.endsWith('.json')) continue;
      const id = Number(file.replace(/\.json$/, ''));
      const full = join(PENDING_DIR, file);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      // Older than the TTL: Telegram will not replay it either, drop it.
      if (stat.mtimeMs < cutoff) {
        try { unlinkSync(full); } catch {}
        continue;
      }
      if (!Number.isInteger(id) || done.has(String(id))) {
        try { unlinkSync(full); } catch {}
        continue;
      }
      try {
        // `at` is the moment the update arrived, which is what the replay loop
        // needs to tell "this was mid-flight when we died" from "this has been
        // sitting here for hours and the person has long since moved on".
        out.push({ update: JSON.parse(readFileSync(full, 'utf8')), id, at: stat.mtimeMs });
      } catch {
        try { unlinkSync(full); } catch {}
      }
    }
    return out.sort((a, b) => a.id - b.id);
  } catch {
    return [];
  }
}
