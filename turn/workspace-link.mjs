// Put a Telegram session into the desktop sidebar's workspace group.
//
// The sidebar groups by a membership list, not by folder: `workspace.json` holds
// `tables.workspaces[<id>].sessionIds`, and a session nobody named falls into
// "Ungrouped". Only two paths ever add an id — the web host when it creates the
// session, and a one-time migration on a fresh registry — so a headless turn
// creates a session that works and looks homeless.
//
// The bridge cannot ask DSH to attach it (there is no such API for an existing
// id), so it keeps the list itself: after a turn, the session id goes into the
// workspace whose `path` is the turn's folder. Two rules keep that honest —
// write only when the id is genuinely absent, and write atomically, so a host
// that has the file open never reads half of it.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DSH_HOME } from '../core/paths.mjs';

/** The store DSH's sidebar reads. */
export function workspaceFile() {
  return join(DSH_HOME, 'storages', 'workspace.json');
}

/** Two path strings name one folder? Windows is case-insensitive, POSIX is not. */
function samePath(a, b) {
  const clean = (value) => String(value || '').trim().replace(/[\\/]+$/, '');
  const left = clean(a);
  const right = clean(b);
  if (!left || !right) return false;
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * Which workspace owns this folder: the exact match, else the only workspace.
 *
 * A folder no workspace claims and a registry with several candidates are both
 * refusals: the wrong group is worse than the "Ungrouped" the sidebar shows now,
 * because a wrong group says the session belongs somewhere it never ran.
 */
export function pickWorkspace(workspaces, cwd) {
  const rows = Object.values(workspaces || {}).filter((row) => row && Array.isArray(row.sessionIds));
  const exact = rows.filter((row) => samePath(row.path, cwd));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  return rows.length === 1 ? rows[0] : null;
}

/**
 * Add `sessionId` to the workspace that owns `cwd`.
 *
 * Returns 'linked', 'present' (already there), 'no-workspace', 'no-store' or
 * 'bad-store'. The caller logs the line; a failure here must never fail a turn.
 */
export function linkSession({ sessionId, cwd, file = workspaceFile() }) {
  const id = String(sessionId || '').trim();
  if (!id) return 'no-session';
  if (!existsSync(file)) return 'no-store';
  let store = null;
  try {
    store = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return 'bad-store';
  }
  const workspaces = store?.tables?.workspaces;
  if (!workspaces || typeof workspaces !== 'object') return 'bad-store';
  // Already named by any workspace: the sidebar shows it in a group, and a
  // second copy would make the same session appear twice.
  for (const row of Object.values(workspaces)) {
    if (Array.isArray(row?.sessionIds) && row.sessionIds.includes(id)) return 'present';
  }
  const target = pickWorkspace(workspaces, cwd);
  if (!target) return 'no-workspace';
  target.sessionIds.push(id);
  try {
    // Temp file in the same folder, then rename: a rename is atomic, so the host
    // sees either the old list or the new one, never a truncated file.
    const temp = `${file}.bridge-${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(store), 'utf8');
    renameSync(temp, file);
  } catch {
    return 'write-failed';
  }
  return 'linked';
}
