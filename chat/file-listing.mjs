// One folder of the topic as rows of buttons.
//
// `/ls` lists a folder and `/view` opens a file, but the press that walks into
// the next folder lives in the callback router — so the drawing and the reading
// sit here, in `chat/`, and both sides import the same functions instead of one
// importing the other.
import { readdirSync } from 'node:fs';
import { resolveInRoot } from '../lib/file-fence.mjs';
import { t } from '../core/i18n.mjs';

/** Rows one folder card shows; more than this and the answer says how many. */
export const LIST_CAP = 40;

/** Folders a listing skips: real, but noise for a person reading from a phone. */
const SKIP = new Set(['node_modules', '.git']);

/**
 * One folder as rows: folders first, then files, both alphabetically.
 *
 * @returns {{ refusal: string } | { rows: {name: string, dir: boolean}[],
 *   total: number, dirs: number, files: number }}
 */
export function listDir(root, rel) {
  const fenced = resolveInRoot(root, rel || '.');
  if (fenced.refusal) return { refusal: fenced.refusal };
  if (!fenced.dir) return { refusal: 'notDir' };
  let names;
  try {
    names = readdirSync(fenced.path, { withFileTypes: true });
  } catch {
    return { refusal: 'missing' };
  }
  const rows = names
    .filter((row) => !SKIP.has(row.name))
    .map((row) => ({ name: row.name, dir: row.isDirectory() }))
    .sort((a, b) => (a.dir !== b.dir ? (a.dir ? -1 : 1) : a.name.localeCompare(b.name)));
  const dirs = rows.filter((row) => row.dir).length;
  return { rows, total: rows.length, dirs, files: rows.length - dirs };
}

/** Text and buttons for one folder card; the rows are already capped. */
export function listingCard(rel, result, lang) {
  const lines = [t(lang, 'ctrl.ls.head', { path: rel || '.', dirs: result.dirs, files: result.files })];
  const shown = result.rows.slice(0, LIST_CAP);
  if (result.total > shown.length) lines.push(t(lang, 'ctrl.ls.cap', { shown: shown.length, total: result.total }));
  if (shown.length === 0) lines.push(t(lang, 'ctrl.ls.emptyDir'));
  return {
    text: lines.join('\n'),
    keyboard: shown.map((row, index) => [{
      text: row.dir ? `${row.name}/` : row.name,
      // The button carries the row number, not the path: callback data is capped
      // at 64 bytes and a path is longer than that. The listing the card was
      // drawn from is kept in the state, so the number still means the same row
      // until the next listing replaces it — and a replaced one answers "stale"
      // instead of opening whatever moved into that place.
      data: `fv:${index}`,
    }]),
  };
}
