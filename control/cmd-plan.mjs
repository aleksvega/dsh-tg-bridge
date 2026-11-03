// `/plan` — turn the topic's plan mode on or off, and say who is holding it.
//
// A toggle rather than a report: the old card explained that the switch lives in
// the host and could not be flipped from the chat, which was accurate and left
// the person with nothing to press. The state is the bridge's own, so it survives
// a restart with the rest of `state.json`, and a neighbouring topic is untouched.
import { t } from '../core/i18n.mjs';
import { saveState as saveNow } from '../core/state.mjs';
import { planOf, sandboxEnforces } from './plan-mode.mjs';

/** The body of the answer: the state, what it means, and who enforces it. */
function say(lang, on, forced) {
  const lines = [
    t(lang, on ? 'ctrl.planmode.onHead' : 'ctrl.planmode.offHead'),
    '',
    on ? t(lang, 'ctrl.planmode.onBody') : t(lang, 'ctrl.planmode.offBody'),
  ];
  if (on) lines.push('', forced ? t(lang, 'ctrl.planmode.guaranteeSandbox') : t(lang, 'ctrl.planmode.guaranteeModel'));
  return lines.join('\n');
}

export async function handlePlanCommands(ctx) {
  const { effective, arg, lang, reply, key, state: st } = ctx;
  if (effective !== '/plan') return false;
  const save = ctx.saveState || saveNow;
  const word = String(arg || '').trim().toLowerCase();
  const held = planOf(st, key);
  const forced = sandboxEnforces(key);

  // A bare `/plan` is the switch. `on` and `off` are for the person who wants to
  // be certain, and for an instruction a script cannot check.
  const next = word === 'on' ? true : word === 'off' ? false : !held;
  st.planMode = st.planMode || {};
  if (next) {
    // An id per switch, not per turn: `/plan` twice in a row must not resurrect
    // a card whose plan was thrown away by the previous `/plan off`.
    st.planMode[key] = { on: true, id: `p${Date.now().toString(36)}`, request: '', at: Date.now() };
  } else {
    // Off drops the card with it: a leftover id would let an old Approve press
    // start a turn the person has already walked away from.
    delete st.planMode[key];
  }
  save();
  await reply(say(lang, next, forced));
  return true;
}
