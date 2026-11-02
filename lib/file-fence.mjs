// One fence in front of every file the chat touches: `/find` reads through it,
// and `/ls` and `/edit` will too.
//
// Two rules, both learned the hard way. Nothing outside the topic's folder is
// read, because a path from a chat message is not a permission. And a file is
// opened only when it is plausibly text and plausibly small: a 400 MB log would
// freeze the turn that asked for one line of it, and a binary would put noise in
// the chat. A refusal is a sentence with a reason, never a stack trace.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** A text file bigger than this is refused rather than read. */
export const MAX_BYTES = 512 * 1024;

/** How far a walk goes before it says it stopped. */
export const BOUND = { files: 4000, ms: 1500, depth: 8 };

/** Folders that never hold an answer and can hold thousands of files. */
export const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.cache',
  '.turbo', 'vendor', '__pycache__', '.venv', 'venv', 'target', 'out',
]);

/**
 * Resolve `target` inside `root`.
 *
 * An absolute path is allowed only when it is already inside the root: the chat
 * has no way to ask for a permit, so "outside" is a refusal with the root named,
 * which tells the person where they actually are.
 *
 * @returns {{ path: string } | { refusal: 'outside' | 'missing' | 'empty' }}
 */
export function resolveInRoot(root, target) {
  const base = String(root || '').trim();
  const asked = String(target || '').trim();
  if (!base) return { refusal: 'empty' };
  const full = isAbsolute(asked) ? resolve(asked) : resolve(base, asked || '.');
  const rel = relative(resolve(base), full);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return { refusal: 'outside' };
  try {
    const info = statSync(full);
    return { path: full, dir: info.isDirectory(), size: info.size };
  } catch {
    return { refusal: 'missing' };
  }
}

/** Does this buffer look like text rather than a picture or an archive? */
export function looksText(buffer) {
  const head = buffer.subarray(0, 4096);
  for (const byte of head) {
    // NUL is the honest signal: a text file of any encoding has none in its head.
    if (byte === 0) return false;
  }
  return true;
}

/**
 * Read one file through the fence.
 *
 * @returns {{ text: string } | { refusal: 'large' | 'binary' | 'missing' | 'dir' }}
 */
export function readTextFile(path) {
  try {
    const info = statSync(path);
    if (info.isDirectory()) return { refusal: 'dir' };
    if (info.size > MAX_BYTES) return { refusal: 'large' };
    const buffer = readFileSync(path);
    if (!looksText(buffer)) return { refusal: 'binary' };
    return { text: buffer.toString('utf8') };
  } catch {
    return { refusal: 'missing' };
  }
}

/**
 * Write one file through the fence.
 *
 * Only `/edit` calls this, and only after the person pressed the button on a
 * diff they were shown. The same refusals as reading apply: a directory is not
 * a file, and a file that grew past the cap is not something the chat should be
 * asked to rewrite in one message.
 *
 * @returns {{ ok: true, bytes: number } | { refusal: 'dir' | 'large' | 'missing' }}
 */
export function writeTextFile(path, text) {
  try {
    const info = statSync(path);
    if (info.isDirectory()) return { refusal: 'dir' };
    if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { refusal: 'large' };
    writeFileSync(path, text, 'utf8');
    return { ok: true, bytes: Buffer.byteLength(text, 'utf8') };
  } catch (error) {
    // A file removed between the preview and the press is the common case, and
    // it is a refusal rather than a new file: `/edit` never creates one.
    if (error?.code === 'ENOENT') return { refusal: 'missing' };
    throw error;
  }
}

/**
 * Walk a folder, bounded by files, milliseconds and depth.
 *
 * Returns what it reached and whether it stopped early, because a search that
 * silently gives up looks exactly like a search that found nothing — and those
 * are different answers.
 *
 * @returns {{ files: string[], stopped: boolean, skipped: number }}
 */
export function walkFiles(root, bound = BOUND) {
  const files = [];
  let skipped = 0;
  let stopped = false;
  const started = Date.now();
  const visit = (dir, depth) => {
    if (stopped) return;
    if (depth > bound.depth) {
      stopped = true;
      return;
    }
    let rows = [];
    try {
      rows = readdirSync(dir, { withFileTypes: true });
    } catch {
      skipped += 1;
      return;
    }
    for (const row of rows) {
      if (stopped) return;
      if (files.length >= bound.files || Date.now() - started > bound.ms) {
        stopped = true;
        return;
      }
      const full = resolve(dir, row.name);
      if (row.isDirectory()) {
        if (SKIP_DIRS.has(row.name) || row.name.startsWith('.')) continue;
        visit(full, depth + 1);
        continue;
      }
      if (!row.isFile()) continue;
      files.push(full);
    }
  };
  visit(resolve(root), 0);
  return { files, stopped, skipped };
}