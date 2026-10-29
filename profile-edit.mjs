// Addressable edits of a Cordis profile patch.
//
// The desktop app edits these same files through its settings page: a patch row
// `- id: <row>` + `name: <package>` + `config:` carries exactly the keys the
// loader would otherwise take from the bundle. The bridge needs the same power
// for the knobs a person sets from Telegram (subagent model, reasoning effort,
// permission preset) without a YAML parser: a hand-rolled YAML round-trip would
// rewrite comments, anchors and quoting across a file that is the user's config.
//
// So edits are surgical and line-based: find the row by its package name, walk
// the config path by indent, replace the single value line, or insert the key
// where YAML expects it. Every function here is pure text -> text|null and is
// covered by tests, because a misplaced line silently changes how a profile runs.

/** Indent width of a line, in spaces. */
const indentOf = (line) => /^\s*/.exec(line)[0].length;

/** The line ending the document already uses, so an edit does not rewrite it. */
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

/** A scalar as YAML: bare for the shapes profiles use, quoted otherwise. */
function scalar(value) {
  const text = String(value);
  if (/^[A-Za-z0-9._/@:-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

/** The lines a value occupies when written under `key:` at `pad` indentation. */
function valueLines(key, pad, value) {
  const lines = [`${pad}${key}:`];
  if (Array.isArray(value)) {
    for (const item of value) lines.push(`${pad}  - ${scalar(item)}`);
    return lines;
  }
  lines[0] = `${pad}${key}: ${scalar(value)}`;
  return lines;
}

/**
 * Index one past the last line deeper than `indent`, starting at `from`.
 * Blank lines inside the block count, trailing ones do not: a separator between
 * two rows must survive an edit that rewrites the block above it.
 */
function blockEnd(lines, from, indent) {
  let end = from + 1;
  for (let i = from + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (indentOf(line) <= indent) break;
    end = i + 1;
  }
  return end;
}

/**
 * Every row of the patch that declares `pkg`, with the line range it owns.
 * `match` receives the row's own lines and can reject a row (two delegation
 * tools share one package).
 * @param {string[]} lines patch lines
 * @param {string} pkg package name of the row
 * @param {(row: { text: string, id: string }) => boolean} [match]
 */
function rowsOf(lines, pkg, match) {
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const nameLine = /^\s*name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(lines[i]);
    if (!nameLine || nameLine[1] !== pkg) continue;
    let rowIndent = Math.max(0, indentOf(lines[i]) - 2);
    for (let back = i - 1; back >= 0 && back >= i - 3; back -= 1) {
      if (/^\s*-\s*(id|name):/.test(lines[back])) {
        rowIndent = indentOf(lines[back]);
        break;
      }
    }
    const end = blockEnd(lines, i, rowIndent);
    const idLine = i > 0 ? /^\s*-\s*id:\s*(\S+)\s*$/.exec(lines[i - 1]) : null;
    const row = { text: lines.slice(i, end).join('\n'), id: idLine ? idLine[1] : '' };
    if (!match || match(row)) out.push({ nameIndex: i, rowIndent, end, row });
  }
  return out;
}

/**
 * Set one key of a row's `config:`, creating the config block and any missing
 * parent keys. Returns null when no row matches or the value is unchanged.
 * @param {string} text profile patch
 * @param {object} edit
 * @param {string} edit.pkg package whose row is edited
 * @param {string[]} edit.path key path inside `config:` (`['agentOptions','model']`)
 * @param {string|number|string[]} edit.value scalar or list
 * @param {(row: { text: string, id: string }) => boolean} [edit.match] row filter
 */
export function setRowConfig(text, { pkg, path, value, match }) {
  const source = String(text ?? '');
  const eol = eolOf(source);
  const lines = source.split(/\r?\n/);
  const rows = rowsOf(lines, pkg, match);
  if (rows.length === 0) return null;
  let changed = 0;
  // Bottom-up: an insertion earlier in the file must not shift the rows below.
  for (const row of rows.sort((a, b) => b.nameIndex - a.nameIndex)) {
    if (applyPath(lines, row, path, value)) changed += 1;
  }
  return changed > 0 ? lines.join(eol) : null;
}

/** Does the patch declare a row for `pkg` at all? */
export function rowExists(text, pkg) {
  return rowsOf(String(text ?? '').split(/\r?\n/), pkg).length > 0;
}

/**
 * Append a row the patch does not have yet — the other half of "make the file
 * say one thing": a setting the profile never mentioned needs a row before it
 * can be written into one.
 *
 * Returns null when a row for `pkg` is already there, so a caller may call this
 * unconditionally without ending up with two rows that disagree.
 * @param {string} text profile patch
 * @param {{id: string, pkg: string, config?: Record<string, string|number>}} row
 */
export function appendRow(text, { id, pkg, config = {} }) {
  const source = String(text ?? '');
  if (rowExists(source, pkg)) return null;
  const eol = eolOf(source);
  const lines = source.split(/\r?\n/);
  // Drop trailing blanks so the new row starts after exactly one separator.
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  const insert = ['- id: ' + id, `  name: '${pkg}'`];
  const keys = Object.entries(config).filter(([, value]) => value !== '' && value !== undefined && value !== null);
  if (keys.length > 0) {
    insert.push('  config:');
    for (const [key, value] of keys) insert.push(...valueLines(key, '    ', value));
  }
  lines.push('', ...insert, '');
  return lines.join(eol);
}

/**
 * Remove one key from a row's config, with the lines nested under it.
 * Returns null when nothing was there to remove.
 */
export function unsetRowConfig(text, { pkg, path, match }) {
  const source = String(text ?? '');
  const eol = eolOf(source);
  const lines = source.split(/\r?\n/);
  const rows = rowsOf(lines, pkg, match);
  if (rows.length === 0) return null;
  let changed = 0;
  for (const row of rows.sort((a, b) => b.nameIndex - a.nameIndex)) {
    const at = locate(lines, row, path);
    if (!at || at.valueIndex < 0) continue;
    lines.splice(at.valueIndex, blockEnd(lines, at.valueIndex, at.indent) - at.valueIndex);
    changed += 1;
  }
  return changed > 0 ? lines.join(eol) : null;
}

/** Indices of the `config:` line of a row and of its children, or null. */
function configOf(lines, row) {
  for (let i = row.nameIndex + 1; i < row.end; i += 1) {
    if (/^\s*config:\s*$/.test(lines[i])) return i;
  }
  return -1;
}

/**
 * Children of the block that opens at `parent`, at exactly `indent`.
 * @param {boolean} blockOnly require `key:` with nothing after it (a mapping)
 * @returns index of the child line, or -1
 */
function childOf(lines, rowEnd, parent, indent, key, blockOnly) {
  const pattern = blockOnly ? new RegExp(`^\\s*${key}:\\s*$`) : new RegExp(`^\\s*${key}:`);
  for (let i = parent + 1; i < rowEnd; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (indentOf(line) < indent) break;
    if (indentOf(line) !== indent) continue;
    if (pattern.test(line)) return i;
  }
  return -1;
}

/**
 * Walk `path` under the row's config without writing anything.
 * Returns null when the row has no config block at all. Otherwise it names the
 * deepest key that exists (`parentIndex`) and the keys still missing under it
 * (`rest`), so one code path writes both a fresh leaf and a fresh subtree.
 */
function locate(lines, row, path) {
  const configIndex = configOf(lines, row);
  if (configIndex < 0) return null;
  let cursor = configIndex;
  let indent = indentOf(lines[configIndex]) + 2;
  for (let depth = 0; depth < path.length - 1; depth += 1) {
    const found = childOf(lines, row.end, cursor, indent, path[depth], true);
    if (found < 0) return { valueIndex: -1, indent, parentIndex: cursor, rest: path.slice(depth) };
    cursor = found;
    indent += 2;
  }
  const leaf = childOf(lines, row.end, cursor, indent, path[path.length - 1], false);
  if (leaf >= 0) return { valueIndex: leaf, indent, parentIndex: cursor, rest: [] };
  return { valueIndex: -1, indent, parentIndex: cursor, rest: [path[path.length - 1]] };
}

/**
 * Write `path` into one row, creating intermediate keys where they are absent.
 * @returns true when the row changed.
 */
function applyPath(lines, row, path, value) {
  const at = locate(lines, row, path);
  if (!at) {
    // No config block at all: build it under the row's own keys.
    const pad = ' '.repeat(row.rowIndent + 2);
    const insert = [`${pad}config:`];
    let deep = pad + '  ';
    for (let depth = 0; depth < path.length - 1; depth += 1) {
      insert.push(`${deep}${path[depth]}:`);
      deep += '  ';
    }
    insert.push(...valueLines(path[path.length - 1], deep, value));
    lines.splice(row.nameIndex + 1, 0, ...insert);
    return true;
  }

  if (at.valueIndex < 0) {
    // Missing key or subtree: append it at the end of the deepest block that
    // does exist, so the block keeps the order a person would have written.
    const pad = ' '.repeat(at.indent);
    const insert = [];
    let deep = pad;
    for (const key of at.rest.slice(0, -1)) {
      insert.push(`${deep}${key}:`);
      deep += '  ';
    }
    insert.push(...valueLines(at.rest[at.rest.length - 1], deep, value));
    const parentIndent = indentOf(lines[at.parentIndex]);
    lines.splice(blockEnd(lines, at.parentIndex, parentIndent), 0, ...insert);
    return true;
  }

  const pad = ' '.repeat(at.indent);
  const replacement = valueLines(path[path.length - 1], pad, value);
  const current = lines.slice(at.valueIndex, blockEnd(lines, at.valueIndex, at.indent));
  if (current.join('\n') === replacement.join('\n')) return false;
  lines.splice(at.valueIndex, current.length, ...replacement);
  return true;
}
