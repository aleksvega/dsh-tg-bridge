// The files a turn wrote, as rows the card can send back as documents.
//
// A turn that produces a report, a screenshot or a build says "it is in Docs"
// and leaves it there. The person is on a phone, so "Docs" is another machine
// away: what they need is the file itself, in the chat, without typing a path
// they could not have guessed. The path is not invented here — it is the one the
// tool call already carried, so nothing is sent that the turn did not touch.
//
// Only writes count. A turn that read forty files is not a turn that produced
// forty, and a card offering to send them would be a file manager nobody asked
// for.
import { extname } from 'node:path';

/**
 * Tools that leave a file behind, in the shape each one names its target.
 *
 * `write` creates, `edit` changes, `read_image` is here only to be excluded — it
 * is named in `IGNORED` because its argument is still a real path and a naive
 * `file_path` match would offer the input as an output.
 */
const WRITES = new Set(['write', 'edit', 'multi_edit', 'apply_patch', 'notebook_write']);

/** Paths this feature must never offer, however the call spelled them. */
const IGNORED = new Set(['read', 'read_image', 'view', 'list_dir']);

/**
 * Extensions Telegram will deliver as a document.
 *
 * It refuses some names outright and previews others as media; both are fine as
 * a document, so the list only holds ordinary text and data files that a phone
 * can open. Anything else is dropped rather than offered as a button that fails.
 */
const SENDABLE = new Set([
  '.md', '.txt', '.json', '.csv', '.tsv', '.log', '.yml', '.yaml', '.xml',
  '.html', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py',
  '.ps1', '.sh', '.sql', '.toml', '.ini', '.cfg', '.diff', '.patch',
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.zip', '.gz',
  '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.epub',
]);

/** How many rows the card can carry before it stops being a summary. */
export const FILES_CAP = 5;

const isIgnored = (tool) => IGNORED.has(String(tool || ''));

/**
 * One row per file the turn wrote, newest call last-wins, de-duplicated.
 *
 * The same file written twice is one row: two buttons would send the same bytes
 * and make the card look busier than the turn was.
 */
export function turnFiles(calls = []) {
  const byPath = new Map();
  for (const call of calls) {
    const tool = String(call?.tool || '');
    if (!WRITES.has(tool) || isIgnored(tool)) continue;
    const input = call?.input ?? {};
    const path = String(input.file_path ?? input.path ?? '').trim();
    if (!path) continue;
    const parts = path.split(/[\\/]/).filter(Boolean);
    const name = parts.pop() || path;
    if (!SENDABLE.has(extname(name).toLowerCase())) continue;
    // The folder is kept, not just the name: one turn routinely writes the same
    // file name in three locales or three modules, and three buttons reading
    // "files.mjs" are three buttons nobody can tell apart.
    byPath.set(path, { path, name: name.slice(0, 40), dir: (parts.pop() || '').slice(0, 14) });
  }
  const rows = [...byPath.values()].slice(-FILES_CAP);
  // Only disambiguate when the names actually collide: a folder in front of every
  // button would be noise for the common case of one file.
  const seen = new Map();
  for (const row of rows) seen.set(row.name, (seen.get(row.name) || 0) + 1);
  return rows.map((row) => ({
    path: row.path,
    name: seen.get(row.name) > 1 && row.dir ? `${row.dir}/${row.name}` : row.name,
  }));
}

/**
 * Buttons for those rows.
 *
 * The callback carries the row number, not the path: Telegram caps callback data
 * at 64 bytes and a real path does not fit. The rows themselves are kept in
 * `state.turnFiles[key]`, so a press resolves against the card it was drawn
 * from — and a card replaced by a newer turn answers "stale" instead of sending
 * whatever took that number.
 */
export function fileKeyboard(files, lang, t) {
  if (!files?.length) return [];
  const head = t(lang, 'card.files.button');
  return files.map((file, index) => [{
    text: `📎 ${head}: ${file.name}`.slice(0, 64),
    callback_data: `tf:${index}`,
  }]);
}
