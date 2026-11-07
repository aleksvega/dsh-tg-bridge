// A task travels as the last argv element of the spawned CLI, and a Windows
// command line is a hard 32 767 UTF-16 chars — everything past that dies as
// `spawn ENAMETOOLONG` before the model ever sees the text. Two attached text
// files arrived as one 72 000-char prompt and did exactly that.
//
// The valve: a task past the limit moves to a file, and argv keeps only a
// short sentence pointing at it. The model pays one read; the turn lives.
// Files land in the OS temp dir, where the OS cleans them up.
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Comfortably under 32 767, minus the couple hundred chars of argv around it. */
export const TASK_ARG_LIMIT = 24_000;

/**
 * The text that belongs on the command line, plus the file it went to.
 * `wrap` turns the path into the sentence the model reads instead; it is
 * injected so this module stays free of the i18n import cycle surface.
 */
export function condenseTask(task, wrap) {
  if (typeof task !== 'string' || task.length <= TASK_ARG_LIMIT) return { text: task, file: '' };
  const file = join(tmpdir(), `dsh-tg-task-${randomUUID().slice(0, 8)}.md`);
  writeFileSync(file, task, 'utf8');
  return { text: wrap(file), file };
}
