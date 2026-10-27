// Sessions the harness already wrote: the recent list, the title of one, and the small formatters around them.
//
// Split out of `control.mjs` by the 500-line plan: the command handlers that
// follow call these, and none of them needs the dispatcher to do it.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../i18n.mjs';
import { DSH_HOME } from '../paths.mjs';

import { read, readJson } from './models.mjs';
/** DSH's on-disk folder name for a workspace: `--C-Users-me-work--`. */
export function cwdSlug(cwd) {
  const parts = String(cwd).replace(/[:\\/]+/g, '\\').split('\\').filter(Boolean);
  return `--${parts.join('-')}--`;
}

/** Session ids appear both bare and as `session-<uuid>`; compare the bare form. */
export function bareId(id) {
  return String(id).replace(/^session-/, '');
}

/** `2026-10-25 17:11` in the machine's own zone, for the status card. */
export function stamp(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Recent DSH sessions of this workspace, newest first, with their titles. */
export function recentSessions(cwd, limit, lang = 'en') {  const root = join(DSH_HOME, 'sessions');
  const rows = [];
  let dirs = [];
  try {
    dirs = readdirSync(root);
  } catch {
    return rows;
  }
  for (const dir of dirs) {
    const path = join(root, dir);
    let files = [];
    try {
      files = readdirSync(path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of files) {
      // Layout is <slug>/<session-id>/session.v4.jsonl.zstd, so the session id is
      // the directory name and the archive one level below it.
      if (!entry.isDirectory()) continue;
      const full = join(path, entry.name, 'session.v4.jsonl.zstd');
      try {
        rows.push({ cwd: dir, id: entry.name, mtime: statSync(full).mtimeMs });
      } catch {}
    }
  }
  if (rows.length === 0) return rows;
  const cacheDir = join(DSH_HOME, 'storages', 'session_projcache', 'sessions');
  const cacheFiles = (() => {
    try {
      return readdirSync(cacheDir);
    } catch {
      return [];
    }
  })();
  const titles = new Map();
  for (const name of cacheFiles) {
    const record = readJson(join(cacheDir, name));
    const id = name.replace(/^session-/, '').replace(/\.json$/, '');
    const rows = record?.record?.rows ?? record?.rows ?? {};
    const title = rows.title?.val;
    // Sessions that were never titled still carry their first user message.
    const firstMessage = rows.titleInput?.val?.first?.text;
    const cwd = record?.record?.identity?.cwd ?? record?.identity?.cwd;
    const label =
      typeof title === 'string' && title.trim()
        ? title.trim()
        : typeof firstMessage === 'string' && firstMessage.trim()
          ? firstMessage.trim().split('\n')[0].slice(0, 80)
          : '';
    if (label) titles.set(id, { title: label, cwd });
  }
  const live = rows.filter((row) => {
    const meta = titles.get(bareId(row.id));
    return meta && (meta.cwd === cwd || row.cwd === cwdSlug(cwd));
  });
  const pool = live.length > 0 ? live : rows;
  return pool
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((row) => ({ ...row, title: titles.get(bareId(row.id))?.title || t(lang, 'ctrl.sessions.untitled') }));
}

/**
 * A session's title, read from DSH's own projection cache. `/sessions` already
 * shows these, and the status card is a worse place to lose one: the card is
 * what a person screenshots. Empty when the session was never titled.
 */
export function sessionTitle(id) {
  const record = readJson(join(DSH_HOME, 'storages', 'session_projcache', 'sessions', `session-${bareId(id)}.json`));
  const rows = record?.record?.rows ?? record?.rows ?? {};
  const title = rows.title?.val;
  if (typeof title === 'string' && title.trim()) return title.trim();
  const first = rows.titleInput?.val?.first?.text;
  if (typeof first === 'string' && first.trim()) return first.trim().split('\n')[0].slice(0, 80);
  return '';
}
