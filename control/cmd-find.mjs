// `/find`: where does this string live in this project.
//
// The chat could send a file and show a diff, but not answer the question that
// sends a person back to their desk — "which file has this line". The search is
// literal on purpose: a query is text a person typed, not a pattern, and a stray
// dot must not change the answer or throw.
import { relative } from 'node:path';
import { readTextFile, resolveInRoot, walkFiles } from '../lib/file-fence.mjs';
import { t } from '../core/i18n.mjs';
import { config } from '../core/state.mjs';

/** Rows the card shows; more than this and the answer says how many more. */
export const CAP = 20;

/** Matches inside one already-open file. */
export function hitsInText(text, path, needle) {
  const hits = [];
  const lines = String(text).split(/\r?\n/);
  for (let at = 0; at < lines.length; at += 1) {
    if (!lines[at].includes(needle)) continue;
    hits.push({ path, line: at + 1, text: lines[at].trim().slice(0, 120) });
  }
  return hits;
}

/**
 * Search `root` for `query`, literally.
 *
 * A file the fence refuses is counted as skipped and never opened: reading a
 * binary to prove it is binary is the cost the fence exists to avoid.
 *
 * @returns {{ hits: {path: string, line: number, text: string}[], found: number,
 *   skipped: number, stopped: boolean }}
 */
export function findInFiles(root, query, { cap = CAP, bound } = {}) {
  const needle = String(query || '');
  const hits = [];
  let found = 0;
  let skipped = 0;
  const walked = walkFiles(root, bound);
  for (const full of walked.files) {
    const read = readTextFile(full);
    if (read.refusal) {
      skipped += 1;
      continue;
    }
    const rows = hitsInText(read.text, relative(root, full) || full, needle);
    found += rows.length;
    for (const row of rows) if (hits.length < cap) hits.push(row);
  }
  return { hits, found, skipped: skipped + walked.skipped, stopped: walked.stopped };
}

/** The folder this topic works in. */
export function topicRoot(state, key) {
  return (state?.cwd && state.cwd[key]) || config.cwd || '';
}

export async function handleFindCommands(ctx) {
  const { effective, arg, state, key, lang, reply } = ctx;
  if (effective !== '/find') return false;
  const parts = String(arg || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    await reply(t(lang, 'ctrl.find.usage'));
    return true;
  }
  const query = parts[0].replace(/^"|"$/g, '');
  const root = topicRoot(state, key);
  const fenced = resolveInRoot(root, parts.slice(1).join(' ') || '.');
  if (fenced.refusal) {
    await reply(t(lang, `ctrl.find.${fenced.refusal === 'outside' ? 'outside' : fenced.refusal}`, { root }));
    return true;
  }
  if (!fenced.dir) {
    // One file asked for by name: the same answer, without the walk.
    const read = readTextFile(fenced.path);
    if (read.refusal) {
      await reply(t(lang, `ctrl.find.file.${read.refusal}`));
      return true;
    }
    const rows = hitsInText(read.text, fenced.path, query);
    return draw(ctx, { hits: rows.slice(0, CAP), found: rows.length, skipped: 0, stopped: false }, fenced.path, query);
  }
  const result = findInFiles(fenced.path, query);
  return draw(ctx, result, fenced.path, query);
}

/** Draw the answer: rows as buttons, and the counts that make them honest. */
async function draw(ctx, result, root, query) {
  const { state, key, lang, reply } = ctx;
  if (result.found === 0) {
    await reply(t(lang, 'ctrl.find.none', { path: root, query }), { keyboard: [] });
    return true;
  }
  const lines = [t(lang, 'ctrl.find.head', { query, path: root, n: result.found })];
  if (result.stopped) lines.push(t(lang, 'ctrl.find.stopped'));
  if (result.skipped > 0) lines.push(t(lang, 'ctrl.find.skipped', { n: result.skipped }));
  if (result.found > result.hits.length) {
    lines.push(t(lang, 'ctrl.find.cap', { shown: result.hits.length, found: result.found }));
  }
  lines.push('');
  result.hits.forEach((hit, index) => {
    lines.push(`${index + 1}. ${hit.path}:${hit.line}: ${hit.text}`.slice(0, 220));
  });
  // Rows are remembered rather than encoded: callback data is capped at 64 bytes
  // and a path can be longer than that, so the button carries the number and the
  // state carries the hit it points at.
  state.find = state.find || {};
  state.find[key] = {
    root,
    hits: result.hits.map((hit) => ({ file: hit.path, line: hit.line })),
    query,
    at: Date.now(),
  };
  ctx.saveState?.();
  const keyboard = result.hits.map((hit, index) => [{
    text: `${index + 1}. ${hit.path.split(/[\\/]/).pop()}:${hit.line}`.slice(0, 60),
    data: `fs:${index}`,
  }]);
  await reply(lines.join('\n'), { keyboard });
  return true;
}