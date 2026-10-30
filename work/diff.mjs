// The diff card: what changed, one hunk at a time.
//
// A unified diff pasted into a chat is a wall. On a six-inch screen it wraps at
// forty columns, and the one question a person actually has — "should this hunk
// stay?" — cannot be asked of a wall. So the diff is parsed into files and
// hunks, every hunk gets a short id derived from its own content, and the card
// carries a row of buttons per hunk.
//
// The id is the load-bearing part. It is a hash of the path, the header and the
// body, so re-running `git diff` later finds the same id only when the hunk is
// still byte for byte what the person was looking at. That is what makes a
// button press safe: a stale id matches nothing, and the press is refused
// instead of reverting whatever now sits at that line number.
//
// Pure on purpose: text in, text out. The cases below are a test rather than a
// story about a repository.
import { createHash } from 'node:crypto';

export const DIFF_PREFIX = 'df:';

/**
 * `df:x:1a2b3c4d` → `{ action: 'x', id: '1a2b3c4d' }`; anything else is null.
 *
 * `x` explains a hunk, `r` reverts it, `f` redraws the card. Only an eight-hex
 * id is accepted, because anything else is not a button this code drew.
 */
export function diffPress(data) {
  const text = String(data || '');
  if (!text.startsWith(DIFF_PREFIX)) return null;
  const [action, id] = text.slice(DIFF_PREFIX.length).split(':');
  if (action === 'f') return { action, id: '' };
  if (!/^[xr]$/.test(action || '')) return null;
  return /^[0-9a-f]{8}$/.test(id || '') ? { action, id } : null;
}

/** `+++ b/src/app.mjs` → `src/app.mjs`; `/dev/null` stays itself. */
function pathOf(line) {
  return String(line).replace(/^(?:\+\+\+|---) [ab]\//, '').replace(/^(?:\+\+\+|---) /, '').trim();
}

/**
 * Split a unified diff into files, and each file into hunks.
 *
 * Only the shapes `git diff` produces are understood, and anything unrecognised
 * lands in the file header where it does no harm — an unparsed line must never
 * be dropped, because the header is what a revert replays.
 */
export function parseDiff(text) {
  const files = [];
  let file = null;
  let hunk = null;

  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (file) finish(file);
      file = { path: '', status: 'modified', added: 0, removed: 0, binary: false, header: [line], hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    // Anything before the first `diff --git` is git's own chatter, such as
    // "warning: CRLF will be replaced", and belongs to no file. An empty line is
    // the trailing newline of the output, never a line of a diff: a blank line
    // in a hunk is a space-prefixed context line, and the header has none.
    if (!file || line === '') continue;

    if (hunk && (line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line.startsWith('\\'))) {
      hunk.lines.push(line);
      if (line.startsWith('+')) file.added += 1;
      else if (line.startsWith('-')) file.removed += 1;
      continue;
    }
    hunk = null;

    if (line.startsWith('@@')) {
      const at = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
      hunk = {
        header: line,
        tail: at ? at[5] : '',
        oldStart: Number(at ? at[1] : 0),
        oldLines: Number(at?.[2] ?? 1),
        newStart: Number(at ? at[3] : 0),
        newLines: Number(at?.[4] ?? 1),
        lines: [],
        id: '',
      };
      file.hunks.push(hunk);
      continue;
    }
    file.header.push(line);
  }
  if (file) finish(file);
  return files.filter((one) => one.path !== '');
}

/** Work out the path, the status and whether the file is binary. */
function finish(file) {
  const plus = file.header.find((line) => line.startsWith('+++ '));
  const minus = file.header.find((line) => line.startsWith('--- '));
  const renameTo = file.header.find((line) => line.startsWith('rename to '));
  const renameFrom = file.header.find((line) => line.startsWith('rename from '));
  const newPath = plus ? pathOf(plus) : '';
  const oldPath = minus ? pathOf(minus) : '';
  // A binary file has neither `---` nor `+++`: git writes `Binary files a/x and
  // b/x differ` instead, and the only place the name survives is the first line.
  const fromGit = /^diff --git a\/(.+?) b\/(.+)$/.exec(file.header[0] || '');
  const named = (newPath || oldPath) || (fromGit ? fromGit[2] : '');

  if (renameTo && renameFrom) {
    file.path = renameTo.slice('rename to '.length).trim();
    file.status = 'renamed';
  } else if (newPath === '/dev/null' || (!plus && oldPath)) {
    file.path = oldPath;
    file.status = 'deleted';
  } else if (oldPath === '/dev/null') {
    file.path = newPath;
    file.status = 'added';
  } else {
    file.path = named;
    file.status = 'modified';
  }
  file.binary = file.header.some((line) => line.startsWith('Binary files ') || line.startsWith('GIT binary patch'));
  // A binary file has no hunks and therefore no buttons: nothing to review line
  // by line, and an empty keyboard is a promise the card cannot keep.
  for (const one of file.hunks) one.id = hunkId(file.path, one);
}

/** Eight hex characters, derived from everything the hunk is. */
export function hunkId(path, hunk) {
  const body = `${path}\n${hunk.header}\n${hunk.lines.join('\n')}`;
  return createHash('sha1').update(body).digest('hex').slice(0, 8);
}

/** Find a hunk by the id a button carried, or nothing at all. */
export function findHunk(files, id) {
  for (const file of files) {
    for (const hunk of file.hunks) {
      if (hunk.id === id) return { file, hunk };
    }
  }
  return null;
}

/**
 * One hunk as a patch of its own, ready for `git apply -R`.
 *
 * The `index` line is dropped: it pins blob hashes that only matter to a
 * three-way merge, and keeping it would make a revert fail for a reason the
 * person cannot act on.
 */
export function hunkPatch(file, hunk) {
  // Trailing blank lines are the ones the split left behind, and `git apply`
  // reads a blank line between `+++` and `@@` as the end of the header — the
  // patch is then "garbage" and the revert fails for a reason nobody can see.
  const header = file.header.filter((line) => !line.startsWith('index '));
  while (header.length > 0 && header.at(-1).trim() === '') header.pop();
  return `${header.join('\n')}\n${hunk.header}\n${hunk.lines.join('\n')}\n`;
}

/**
 * The card.
 *
 * `limit` is a character budget, not a hunk count: one lockfile hunk is bigger
 * than twenty hunks of source, and a card Telegram refuses is worse than a card
 * that says how much it left out. `detail` false draws the summary only, which
 * is what `/diff stat` is for.
 */
export function renderDiffCard({ files = [], untracked = [], t, limit = 3400, detail = true }) {
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);

  if (files.length === 0 && untracked.length === 0) {
    return { text: t('diff.noChanges'), keyboard: [], shown: 0, hidden: 0 };
  }

  const lines = [];
  const keyboard = [];
  let used = 0;
  let hidden = 0;
  let filesHidden = 0;
  const push = (line) => {
    lines.push(line);
    used += line.length + 1;
  };

  if (files.length > 0) push(t('diff.head', { files: files.length, added, removed }));
  if (untracked.length > 0) {
    const shown = untracked.slice(0, 8);
    const more = untracked.length > shown.length ? ` +${untracked.length - shown.length}` : '';
    push(t('diff.untracked', { list: `${shown.join(', ')}${more}` }));
  }
  push('');

  for (const file of files) {
    const marks = [];
    if (file.status === 'added') marks.push(t('diff.newFile'));
    if (file.status === 'deleted') marks.push(t('diff.deletedFile'));
    if (file.status === 'renamed') marks.push(t('diff.renamedFile'));
    if (file.binary) marks.push(t('diff.binaryFile'));
    const label = `${file.path}  +${file.added} -${file.removed}${marks.length ? `  (${marks.join(' · ')})` : ''}`;
    // The budget covers the file names too. A repository with two hundred
    // changed files would otherwise spend the whole message on names and hand
    // Telegram something it refuses, which is worse than a card that counts.
    if (used + label.length + 1 > limit) {
      filesHidden += 1;
      hidden += file.hunks.length;
      continue;
    }
    push(label);

    if (!detail) {
      push('');
      continue;
    }
    for (const hunk of file.hunks) {
      const block = [hunk.header, ...hunk.lines];
      const size = block.reduce((sum, line) => sum + line.length + 1, 0);
      if (used + size > limit) {
        hidden += 1;
        continue;
      }
      for (const line of block) push(line);
      const where = hunk.newStart || hunk.oldStart;
      keyboard.push([
        { text: t('diff.explainShort', { line: where }), data: `${DIFF_PREFIX}x:${hunk.id}` },
        { text: t('diff.revertShort', { line: where }), data: `${DIFF_PREFIX}r:${hunk.id}` },
      ]);
    }
    push('');
  }

  if (hidden > 0) push(t('diff.truncated', { n: hidden }));
  if (filesHidden > 0) push(t('diff.truncatedFiles', { n: filesHidden }));
  if (detail && keyboard.length > 0) {
    keyboard.push([{ text: t('diff.refresh'), data: `${DIFF_PREFIX}f` }]);
  }
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), keyboard, shown: keyboard.length, hidden, filesHidden };
}
