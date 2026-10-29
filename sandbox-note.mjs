// A sandbox refusal is not a breakage, and it must not read like one.
//
// The CLI marks three different things with a `[sandbox: …]` line in a tool
// result, and they mean three different things to the person reading the chat:
//
//   denied under <mode>      the policy said no — a decision, not a fault;
//   escalation available     the model may retry wider, and in a chat the
//                            approval prompt cannot be shown, so that retry is
//                            refused too;
//   the runner itself failed the command never ran — that IS a fault, but of
//                            the sandbox, not of the task.
//
// All three used to arrive as an ordinary failed tool call, and the chat said
// "сбой хода" — a word that sends someone to the logs for a decision they made
// themselves. This module turns the marker into a sentence and one honest next
// step. It deliberately offers no "allow anyway" button: there is no per-turn
// escalation channel in a chat, and a button that silently rewrote the profile
// policy would be a security decision taken by a tap on a scrolling message.
import { t } from './i18n.mjs';

/** The three markers, in the order the CLI writes them. */
const MARKERS = [
  { kind: 'denied', re: /\[sandbox: file access denied under ([\w-]+) mode\]/i },
  { kind: 'escalation', re: /\[sandbox: escalation available/i },
  { kind: 'runner', re: /\[sandbox: the sandbox runner itself failed under ([\w-]+) mode/i },
];

/**
 * What the sandbox said, if anything.
 *
 * @param {string} text a tool result's output, or any text a turn produced
 * @returns {{kind: 'denied'|'escalation'|'runner', mode: string} | null}
 */
export function sandboxMarker(text) {
  const body = String(text ?? '');
  if (!body.includes('[sandbox:')) return null;
  for (const marker of MARKERS) {
    const hit = marker.re.exec(body);
    if (hit) return { kind: marker.kind, mode: hit[1] || '' };
  }
  // A marker this build does not know: still a sandbox message, and still not a
  // crash. Saying "denied" would be a guess, so it gets the generic sentence.
  return { kind: 'denied', mode: '' };
}

/**
 * The sentence the chat gets, and the button that leads to the real switch.
 *
 * The keyboard is not a convenience. `/permissions` is where the policy is
 * actually changed, and someone who has just been refused should not have to
 * remember a command name to find it.
 *
 * @param {{kind: string, mode: string}} marker from `sandboxMarker`
 * @param {string} lang
 * @returns {{text: string, keyboard: object|null}}
 */
export function sandboxNote(marker, lang = 'en') {
  if (!marker) return { text: '', keyboard: null };
  const mode = marker.mode || '?';
  const key = marker.kind === 'runner' ? 'sandbox.runner' : 'sandbox.denied';
  const text = t(lang, key, { mode });
  const keyboard = {
    inline_keyboard: [[{ text: t(lang, 'sandbox.open'), callback_data: 'mn:permissions' }]],
  };
  return { text, keyboard };
}

/**
 * Every distinct refusal in a list of tool results, as markers.
 *
 * A turn that walks into the same wall five times should not say so five times:
 * one sentence per distinct (kind, mode) is what the reader needs, and the count
 * is what tells them it was not a one-off.
 *
 * @param {Array<{tool?: string, result?: unknown}>} results
 * @returns {Array<{kind: string, mode: string, count: number, tool: string}>}
 */
export function sandboxRefusals(results) {
  const seen = new Map();
  for (const entry of Array.isArray(results) ? results : []) {
    const body = typeof entry?.result === 'string' ? entry.result : JSON.stringify(entry?.result ?? '');
    const marker = sandboxMarker(body);
    if (!marker) continue;
    const key = `${marker.kind}:${marker.mode}`;
    const found = seen.get(key);
    if (found) found.count += 1;
    else seen.set(key, { ...marker, count: 1, tool: String(entry?.tool || '') });
  }
  return [...seen.values()];
}

/**
 * The note for a whole turn: one sentence per distinct refusal, plus the count
 * when the same wall was hit more than once.
 *
 * @param {Array<{kind: string, mode: string, count: number}>} refusals
 * @param {string} lang
 * @returns {{text: string, keyboard: object|null} | null} null when there is
 *   nothing to say, which is the ordinary case for every turn that ran clean.
 */
export function turnSandboxNote(refusals, lang = 'en') {
  if (!Array.isArray(refusals) || !refusals.length) return null;
  // The worst marker wins: a broken runner is worth more words than a policy
  // that did its job, and one turn cannot be both for the same command.
  const worst = refusals.find((row) => row.kind === 'runner') || refusals[0];
  const { text, keyboard } = sandboxNote(worst, lang);
  const times = refusals.reduce((sum, row) => sum + (row.count || 1), 0);
  return {
    text: times > 1 ? `${text}\n${t(lang, 'sandbox.times', { n: times })}` : text,
    keyboard,
  };
}

/**
 * Report the refusals of a turn that just ended.
 *
 * After the answer, never before: a warning that arrives first reads as "this
 * message failed" before there is anything to fail. One message, one button, and
 * the fix is where the button leads — someone who has just been refused should
 * not have to remember the name of the command that changes the policy.
 *
 * @param {object} input
 * @param {Array} input.refusals failed tool results collected during the turn
 * @param {string} input.lang
 * @param {(text: string, keyboard: object) => Promise<unknown>} input.send
 * @param {(line: string) => void} input.log
 * @param {string} [input.where] for the log line
 * @returns {Promise<boolean>} whether anything was said
 */
export async function reportRefusals({ refusals, lang = 'en', send, log, where = '' }) {
  const note = turnSandboxNote(sandboxRefusals(refusals), lang);
  if (!note) return false;
  try {
    await send(note.text, note.keyboard);
    log(`turn refused by sandbox ${where}: ${note.text.slice(0, 160)}`);
  } catch (error) {
    // A failed notice must not turn a finished turn into a failed one.
    log(`sandbox notice failed ${where}: ${String(error.message).slice(0, 120)}`);
  }
  return true;
}
