// Installing a desktop update from chat: fetch the installer the feed names,
// check it against the feed's hash, then hand it to the OS.
//
// The download is the cheap half. The hash is the point: an installer is the one
// file in this flow a person will double-click, so a byte that does not match the
// manifest is a reason to delete it and say so, never a warning to scroll past.
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { spawn } from 'node:child_process';

/** Bytes as a person reads them: "274 МБ", not "287208544". */
export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

/** Where a downloaded installer goes: visible, outside the app it replaces. */
export function downloadDir(home = process.env.USERPROFILE || process.env.HOME || '.') {
  return join(home, 'Downloads');
}

/**
 * Download `info.installer` and report whether it is the file the feed meant.
 *
 * Returns `{ ok, path, size, verified }`; a hash mismatch deletes the file and
 * returns `ok: false` with the reason, so nothing half-checked is left on disk
 * for someone to double-click later.
 */
export async function downloadInstaller({ info, dir, fetchImpl = fetch, timeout = 30 * 60_000, onProgress = null } = {}) {
  if (!info?.installer) return { ok: false, error: 'no installer in the feed' };
  const name = basename(new URL(info.installer).pathname) || 'dsh-setup.exe';
  mkdirSync(dir, { recursive: true });
  const target = join(dir, name);
  const part = `${target}.part`;
  const res = await fetchImpl(info.installer, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const hash = createHash('sha512');
  let size = 0;
  // A pass-through generator instead of a Transform: the hash is computed as the
  // bytes flow, and the file is written by the same pipeline that reads it.
  async function* metered(stream) {
    for await (const chunk of stream) {
      hash.update(chunk);
      size += chunk.length;
      if (onProgress) onProgress(size);
      yield chunk;
    }
  }
  await pipeline(Readable.fromWeb(res.body), metered, createWriteStream(part));
  const digest = hash.digest('base64');
  const expected = String(info.sha512 || '');
  if (expected && digest !== expected) {
    unlinkSync(part);
    return { ok: false, error: 'sha512 mismatch', verified: false };
  }
  // Only a checked file gets the name someone will click.
  renameSync(part, target);
  return { ok: true, path: target, size: statSync(target).size, verified: Boolean(expected) };
}

/** Open the installer for the person, detached from this process. */
export function launchInstaller(file) {
  const child = spawn(file, [], { detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return Boolean(child.pid);
}