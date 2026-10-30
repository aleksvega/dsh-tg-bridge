// A rewind button must act on the press, not on what was true when it was drawn:
// the session may have moved on since. Both the card and its buttons live here so
// the command that draws it and the press that uses it cannot drift apart.
//
// `undo` and `cut` are passed in by bridge.mjs, which owns the state file.
import { planRewind } from './rewind.mjs';

/** Callback data a rewind button carries: `rw:<verb>:<steps>:<last 8 of session>`. */
const REWIND_CALLBACK = /^rw:(y|n|u):(\d*):([0-9a-f]{8})$/;
const REFUSALS = ['missing', 'tail-incomplete', 'no-turns', 'bad-steps', 'too-many-steps', 'would-leave-open-turn', 'no-header', 'unreadable'];

export function isRewindPress(data) {
  return String(data || '').startsWith('rw:');
}

/**
 * Go back `steps` turns. Returns `{ backup, plan }` or `{ error, plan }`; the
 * error is a reason code from `planRewind` or a thrown message.
 */
export function cutSession(file, steps, applyRewind) {
  const plan = planRewind(file, steps);
  if (plan.reason) return { error: plan.reason, plan };
  try {
    return { backup: applyRewind(file, plan.offset, plan.size), plan };
  } catch (error) {
    return { error: error.message, plan };
  }
}

/**
 * Run one button press and return the one line to show.
 *
 * `ctx` is what `sessionAwareness(key)` gives: `{ sessionId, busy, file, cut,
 * undo }`. A press for another session, or for a topic that is running a turn,
 * changes nothing and says why.
 */
export function answerRewindPress(data, { t, ctx, used = new Set() }) {
  const match = REWIND_CALLBACK.exec(String(data || ''));
  if (!match) return t('ctrl.rewind.stale');
  const [, verb, rawSteps, tail] = match;
  const steps = rawSteps ? Number.parseInt(rawSteps, 10) : 0;
  if (!ctx.sessionId || !ctx.sessionId.endsWith(tail)) return t('ctrl.rewind.stale');
  if (ctx.busy) return t('ctrl.rewind.busy');
  // A card is used once. Without this a double tap on "go back 2" cuts four
  // turns, and the second cut has no card left to undo it from.
  if (verb === 'y' && used.has(data)) return t('ctrl.rewind.stale');
  if (verb === 'y') used.add(data);

  if (verb === 'n') return t('ctrl.rewind.cancelled');
  if (verb === 'u') {
    const done = ctx.undo();
    if (done.error === 'nothing') return t('ctrl.rewind.nothing');
    return done.error ? t('ctrl.rewind.failed', { error: done.error }) : t('ctrl.rewind.undone');
  }
  if (!steps) return t('ctrl.rewind.stale');

  const done = ctx.cut(steps);
  if (done.error) {
    const why = REFUSALS.includes(done.error)
      ? t(`ctrl.rewind.refused.${done.error}`, { total: done.plan?.total ?? 0, dropped: steps })
      : done.error;
    return t('ctrl.rewind.failed', { error: why });
  }
  // The card becomes one line with no buttons: the turns it offered are gone.
  const kept = done.plan ? done.plan.kept : 0;
  if (kept > 0) return t('ctrl.rewind.done', { n: steps, turn: kept, backup: done.backup });
  return t('ctrl.rewind.done.alias', { n: steps, turn: 0 });
}