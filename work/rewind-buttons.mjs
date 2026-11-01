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
  // A missing translation must never reach a chat as the word "undefined": the
  // helper used to be handed the unbound `t`, so `t('ctrl.rewind.cancelled')` read
  // the key as a language and returned String(undefined) — which is what every
  // rewind button said on 2026-11-01. Unknown keys now fall back to the key, which
  // is ugly but true, and a caller's binding mistake stays visible instead of
  // becoming a message.
  const say = (k, vars) => {
    const line = t(k, vars);
    return typeof line === 'string' && line && line !== 'undefined' ? line : k;
  };
  const match = REWIND_CALLBACK.exec(String(data || ''));
  if (!match) return say('ctrl.rewind.stale');
  const [, verb, rawSteps, tail] = match;
  const steps = rawSteps ? Number.parseInt(rawSteps, 10) : 0;
  if (!ctx.sessionId || !ctx.sessionId.endsWith(tail)) return say('ctrl.rewind.stale');
  if (ctx.busy) return say('ctrl.rewind.busy');
  // A card is used once. Without this a double tap on "go back 2" cuts four
  // turns, and the second cut has no card left to undo it from.
  // `rw:n:<steps>` is the usage card's "back N" quick pick — the same cut, one
  // tap. Only `rw:n::` with no number is the cancel button. Reading the verb
  // alone made those two the same press, so "back 2" could only ever cancel.
  const cuts = verb === 'y' || (verb === 'n' && steps > 0);
  if (cuts && used.has(data)) return say('ctrl.rewind.stale');
  if (cuts) used.add(data);

  if (verb === 'n' && !steps) return say('ctrl.rewind.cancelled');
  if (verb === 'u') {
    const done = ctx.undo();
    if (done.error === 'nothing') return say('ctrl.rewind.nothing');
    return done.error ? say('ctrl.rewind.failed', { error: done.error }) : say('ctrl.rewind.undone');
  }
  if (!steps) return say('ctrl.rewind.stale');

  const done = ctx.cut(steps);
  if (done.error) {
    const why = REFUSALS.includes(done.error)
      ? say(`ctrl.rewind.refused.${done.error}`, { total: done.plan?.total ?? 0, dropped: steps })
      : done.error;
    return say('ctrl.rewind.failed', { error: why });
  }
  // The card becomes one line with no buttons: the turns it offered are gone.
  const kept = done.plan ? done.plan.kept : 0;
  if (kept > 0) return say('ctrl.rewind.done', { n: steps, turn: kept, backup: done.backup });
  return say('ctrl.rewind.done.alias', { n: steps, turn: 0 });
}