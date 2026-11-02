// A file in the chat: forty lines at a time, with the line that matched marked.
//
// `/find` results are buttons, and pressing one has to open the file where the
// match is — otherwise the search answers "line 412" to a person holding a phone
// who cannot go to line 412. The window is centred a little above the match so
// the context around it is readable, and "more" keeps going from where it ended.
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { readTextFile, resolveInRoot } from '../lib/file-fence.mjs';
import { t } from '../core/i18n.mjs';

/** Lines in one window. */
export const PAGE = 40;

/** The first line of a window that should contain `line` (1-based). */
export function windowStart(line, size, start = null) {
  const total = Math.max(1, Number(size) || 1);
  if (Number.isFinite(start) && start !== null) return Math.min(Math.max(0, start), Math.max(0, total - 1));
  const target = Math.min(Math.max(1, Number(line) || 1), total);
  return Math.max(0, Math.min(target - 1 - Math.floor(PAGE / 3), Math.max(0, total - PAGE)));
}

/**
 * Text and buttons for one window of a file.
 *
 * @returns {{ text: string, keyboard: object[][], next: number|null } | { refusal: string }}
 */
export function previewWindow({ root, file, line = 1, start = null, lang = 'en' }) {
  const full = isAbsolute(file) ? file : resolve(root, file);
  const inRoot = resolveInRoot(root, full);
  if (inRoot.refusal) return { refusal: inRoot.refusal };
  const read = readTextFile(full);
  if (read.refusal) return { refusal: read.refusal };
  const lines = read.text.split(/\r?\n/);
  const from = windowStart(line, lines.length, start);
  const slice = lines.slice(from, from + PAGE);
  const hit = Number(line);
  const body = slice.map((text, index) => {
    const n = from + index + 1;
    const mark = n === hit ? '▶' : ' ';
    return `${mark} ${String(n).padStart(4, ' ')} ${text}`.slice(0, 160);
  });
  const to = from + slice.length;
  const head = t(lang, 'ctrl.find.preview', { path: file, from: from + 1, to, total: lines.length });
  const next = to < lines.length ? to : null;
  const keyboard = next === null ? [] : [[{
    text: t(lang, 'ctrl.find.more', { n: Math.min(PAGE, lines.length - next) }),
    data: `fs:more:${next}`,
  }]];
  return { text: [head, '', ...body].join('\n'), keyboard, next };
}

/** Read the file back for a size check without keeping it around. */
export function lineCount(file) {
  try {
    return readFileSync(file, 'utf8').split(/\r?\n/).length;
  } catch {
    return 0;
  }
}