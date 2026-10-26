// The rewind card: what will be removed, then one button that removes it. The
// card exists because a rewind deletes turns from the session log — an action
// that should be readable before it happens, not only after.
import { planRewind, recentTurns } from './rewind.mjs';

const PREVIEW = 60;

const clip = (text) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW ? `${flat.slice(0, PREVIEW - 1)}…` : flat;
};

/**
 * `text` for the message and `keyboard` for its buttons.
 *
 * `file` is the session file, or '' when the topic has no session yet; `steps`
 * how far back to go; `phase` is 'confirm' (which turns will be removed) or
 * 'result' (what was actually removed).
 */
export function renderRewindCard({ t: tr, file, sessionId, steps = 1, lang = 'ru' }) {
  const plan = planRewind(file, steps);
  if (plan.reason) {
    return { text: tr(`ctrl.rewind.refused.${plan.reason}`), keyboard: [], plan };
  }
  const turns = recentTurns(file, { limit: Math.max(steps, 8) });
  const doomed = turns.slice(0, steps).reverse();
  const lines = [tr('ctrl.rewind.title', { n: steps }), ''];
  for (const turn of doomed) {
    const who = clip(turn.user) || tr('ctrl.rewind.noText');
    const answer = clip(turn.answer) || tr('ctrl.rewind.noAnswer');
    lines.push(tr('ctrl.rewind.line', { turn: turn.turn, user: who, answer }));
  }
  const keeper = turns[steps];
  if (keeper) {
    lines.push('', tr('ctrl.rewind.keep', { turn: keeper.turn, user: clip(keeper.user) || tr('ctrl.rewind.noText') }));
  } else {
    lines.push('', tr('ctrl.rewind.keep.none'));
  }
  lines.push('', tr('ctrl.rewind.hint'));
  const keyboard = [
    [{ text: tr('ctrl.rewind.button', { n: steps }), callback_data: `rw:y:${steps}:${sessionId.slice(-8)}` }],
    [
      { text: tr('ctrl.rewind.undo'), callback_data: `rw:u::${sessionId.slice(-8)}` },
      { text: tr('ctrl.rewind.cancel'), callback_data: `rw:n::${sessionId.slice(-8)}` },
    ],
  ];
  return { text: lines.join('\n'), keyboard, plan };
}

/** Usage line for `/rewind` with no argument, plus the last few turns to pick from. */
export function renderRewindUsage({ t: tr, file, sessionId }) {
  const turns = recentTurns(file, { limit: 5 });
  const lines = [tr('ctrl.rewind.usage')];
  if (turns.length) {
    lines.push('', tr('ctrl.rewind.recent'));
    for (const turn of turns) lines.push(tr('ctrl.rewind.usageRow', { turn: turn.turn, user: clip(turn.user) || tr('ctrl.rewind.noText') }));
  }
  const rows = [];
  if (turns.length) {
    const row = turns.slice(0, 3).map((turn, index) => ({
      text: tr('ctrl.rewind.back', { n: index + 1 }),
      callback_data: `rw:n:${index + 1}:${sessionId.slice(-8)}`,
    }));
    rows.push(row);
  }
  return { text: lines.join('\n'), keyboard: rows };
}