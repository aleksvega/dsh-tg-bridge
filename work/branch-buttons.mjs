// The 🌿 picker on the rewind card: "branch from this turn" as a tap instead
// of a counted `/rewind fork`. A press never trusts the card it was drawn on —
// the session may have moved on — so the plan is rebuilt from the file at
// press time and the turn number in the callback becomes steps against the
// live total.
//
// The actions themselves do not fork from here: they type `/fork` and
// `/branch new`, so the buttons and the commands can never disagree about
// what a branch is.
import { planFork } from './rewind.mjs';

/** Callback data a 🌿 button carries: `bf:<verb>:<turn>:<last 8 of session>`. */
const BRANCH_CALLBACK = /^bf:([khnx]):(\d{1,6}):([0-9a-f]{8})$/;

export function isBranchPress(data) {
  return String(data || '').startsWith('bf:');
}

/**
 * What one 🌿 press means right now.
 *
 * `{ card }` — redraw the message into a confirm card. `{ command }` — the
 * command the handler should run as if typed. `{ line }` — show this instead
 * (refusal, stale button, cancel); nothing happened.
 */
export function answerBranchPress(data, { t, ctx }) {
  // Same rule as the rewind buttons: a caller's binding mistake must stay a
  // visible key, never the word "undefined" in a chat.
  const say = (k, vars) => {
    const line = t(k, vars);
    return typeof line === 'string' && line && line !== 'undefined' ? line : k;
  };
  const match = BRANCH_CALLBACK.exec(String(data || ''));
  if (!match) return { line: say('ctrl.rewind.stale') };
  const [, verb, rawTurn, tail] = match;
  const turn = Number.parseInt(rawTurn, 10);
  if (!ctx.sessionId || !ctx.sessionId.endsWith(tail)) return { line: say('ctrl.rewind.stale') };
  if (ctx.busy) return { line: say('ctrl.rewind.busy') };
  if (verb === 'x') return { line: say('ctrl.rewind.cancelled') };
  // Turn numbers, not steps, ride in the callback: "branch from turn 42" must
  // mean 42 however many turns arrived since the card was drawn.
  const whole = planFork(ctx.file, 0);
  if (whole.reason) {
    return { line: say(`ctrl.rewind.refused.${whole.reason}`, { total: whole.total, dropped: 0 }) };
  }
  const steps = whole.total - turn;
  // A turn beyond the live total means the session was rewound or switched
  // after the card: the point the button named no longer exists.
  if (steps < 0) return { line: say('ctrl.rewind.stale') };
  if (verb === 'k') {
    return {
      card: {
        text: say('ctrl.branch.confirm', { turn, kept: turn }),
        keyboard: [
          [
            { text: say('ctrl.branch.here'), callback_data: `bf:h:${turn}:${tail}` },
            { text: say('ctrl.branch.new'), callback_data: `bf:n:${turn}:${tail}` },
          ],
          [{ text: say('ctrl.rewind.cancel'), callback_data: `bf:x:${turn}:${tail}` }],
        ],
      },
    };
  }
  return { command: verb === 'h' ? `/fork ${steps}` : `/branch new ${steps}` };
}
