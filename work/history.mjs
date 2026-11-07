// One topic's whole conversation as a single markdown file, for reading on a
// phone. Telegram cannot import old turns as messages, so `/history` ships
// them as a document instead: the session file is the only complete record
// there is, and this module turns it into something a person can open.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Turns to lines: every turn numbered the way the session numbers them, the
 * user's words and the answer under it. Tool calls stay out — the details
 * live in the session, the file is for reading.
 *
 * All display strings arrive from the caller, because they belong to the
 * chat's language, not to this formatter.
 */
export function formatHistory(turns, labels) {
  const out = [`# ${labels.title}`, ''];
  for (const turn of turns) {
    out.push(`## ${labels.turn} ${turn.turn}`, '');
    if (turn.user) out.push(`**${labels.user}**`, '', turn.user, '');
    if (turn.answer) out.push(`**${labels.answer}**`, '', turn.answer, '');
    if (!turn.user && !turn.answer) out.push(`_${labels.silent}_`, '');
  }
  return `${out.join('\n')}\n`;
}

/**
 * Write the file next to the bridge's other reports and return its path.
 * The name carries the time, so two exports from one topic never overwrite
 * each other and "the one from 14:20" stays a thing a person can say.
 */
export function writeHistory(text, dir, at = new Date()) {
  const stamp = at.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = join(dir, `history-${stamp}.md`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, text, 'utf8');
    return path;
  } catch {
    return '';
  }
}
