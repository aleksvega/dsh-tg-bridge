// The instruction file a topic loads on top of the project's own.
//
// The harness loads every candidate name it finds from the project root down to
// the turn's directory, broad first. That chain is the whole mechanism: a topic
// is given a file name of its own, its profile names that file, and the rules
// inside land after `AGENTS.md` and after the global file — specific, not
// authoritative. Two topics in one project keep sharing `AGENTS.md`, and neither
// sees the other's file, because a candidate only loads when a profile names it.
//
// The name is a bare file name on purpose: a candidate is matched per directory,
// so a path would never match and the file would silently never load.
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** What a candidate name may look like: one file, markdown, no directories. */
const NAME = /^[A-Za-z0-9._-]+\.md$/i;
/** A name that is really a path is the mistake worth naming: it can never load. */
const PATHLIKE = /[\\/]/;

/**
 * `AGENTS.game.md` -> `AGENTS.game.md`; anything that cannot be a candidate ->
 * '' so the caller refuses it instead of writing a setting that never applies.
 */
export function instructionName(value) {
  const name = String(value ?? '').trim();
  if (!name || PATHLIKE.test(name) || !NAME.test(name)) return '';
  return name;
}

/** The text a freshly created topic file starts with. */
function docBody(name) {
  return [
    `# ${name}`,
    '',
    'Rules for this topic only. Loaded after the project AGENTS.md and after the',
    'global one, so a line here is the most specific instruction the agent has.',
    '',
  ].join('\n');
}

/**
 * Create the named file in `dir` when it is not there yet.
 *
 * A candidate that does not exist is a silent no-op: the setting would read as
 * applied while nothing changed, and the person would have no way to tell. So
 * naming the file creates it, empty but for its heading, and the answer says
 * where it landed. Written aside and renamed: the harness may read it mid-write.
 *
 * @returns {{file: string, created: boolean}|{error: string}}
 */
export function ensureInstructionFile(name, dir) {
  const clean = instructionName(name);
  if (!clean) return { error: 'bad-name' };
  if (!dir) return { error: 'no-dir' };
  const file = join(dir, clean);
  if (existsSync(file)) return { file, created: false };
  try {
    writeFileSync(`${file}.tmp`, docBody(clean), 'utf8');
    renameSync(`${file}.tmp`, file);
    return { file, created: true };
  } catch (error) {
    return { error: String(error?.message || error) };
  }
}
