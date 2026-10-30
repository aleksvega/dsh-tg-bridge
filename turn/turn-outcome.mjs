// What a finished turn reports: an answer, a failure, or a deliberate stop.
//
// This lives apart from `turn.mjs` because it is the one part of a turn that can
// be decided without a process. The bug it exists to prevent was reported twice
// from the chat: a turn the person stopped with /stop came back as
// «CLI завершился с кодом {code} без вывода» — a failure sentence with a
// placeholder still in it, because a killed child reports `code === null` and
// `t()` only fills the variables it is given a value for.
import { t } from '../core/i18n.mjs';

/** Exit codes that mean "the person asked for this", not "something broke". */
export const STOPPED = 'stopped';

/**
 * Turn a child's exit into `{ text, error, stopped }`.
 *
 * `stopped` is a flag set by `killTurn` before the signal, so a stop is known
 * even though the platform reports it as a failure. It is consumed here — once —
 * because a flag left behind would relabel the NEXT genuine failure.
 */
export function turnOutcome({ code, stopped, stderr = '', stdout = '', finalText = '', lang = 'en' }) {
  if (stopped) return { text: finalText, error: '', stopped: true };
  if (code === 0) return { text: finalText, error: '', stopped: false };
  const errText = String(stderr).trim();
  const outTail = String(stdout)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('{'))
    .join('\n')
    .trim();
  // A bare "exit 1" with an empty stderr tells the person nothing, so fall back
  // to the tail of stdout, where the CLI puts its own error line. `code ?? '?'`
  // is the guard that keeps a `null` from printing as `{code}`.
  const error = errText || outTail.slice(-1200) || t(lang, 'bridge.error.cliDied', { code: code ?? '?' });
  return { text: finalText, error, stopped: false };
}
