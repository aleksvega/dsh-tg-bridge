// Presses on the plan card: Approve runs the request, Keep planning asks for a
// revision. The card carries an id, and an id that is no longer the topic's
// current plan executes nothing — that is what stops a tap on yesterday's card
// from starting work the person has already walked away from.
//
// `redeliver` arrives from the caller rather than being imported: the queue
// already imports this package's siblings, and a second edge back would be a
// cycle the module guard exists to catch.
import { t } from '../core/i18n.mjs';
import { config, state as st, saveState } from '../core/state.mjs';
import { planOf } from '../control/plan-mode.mjs';

/** A message that did not come from Telegram, shaped like one that did. */
function replayMessage(chatId, threadId, text) {
  const thread = Number(threadId) || 0;
  return {
    chat: { id: Number(chatId) },
    from: { id: Number((config.allowedUserIds || [])[0] || chatId) },
    message_id: 0,
    message_thread_id: thread || undefined,
    text: String(text || ''),
  };
}

export async function handlePlanPress({ data, key, lang, chatId, threadId, answer, clearKeyboard, redeliver, log }) {
  const [, verb = '', id = ''] = String(data).split(':');
  if (verb !== 'ok' && verb !== 'more') return false;
  const held = planOf(st, key);

  // No plan, a different plan, or no request behind it: nothing is run and the
  // person is told why. Both verbs answer the same way, because "revise" on a
  // stale card would spend a turn on a plan nobody is looking at any more.
  if (!held || held.id !== id) {
    await answer(t(lang, 'ctrl.planmode.stale'));
    await clearKeyboard();
    return true;
  }
  if (!held.request) {
    await answer(t(lang, 'ctrl.planmode.offNow'));
    await clearKeyboard();
    return true;
  }

  if (verb === 'ok') {
    // Approve is the way out of plan mode: the same words run again, this time
    // free to change the machine, and the flag is cleared before the turn starts
    // so the replay cannot be caught by the same rule a second time.
    const request = held.request;
    delete st.planMode[key];
    saveState();
    log(`plan approved for ${key}`);
    await answer(t(lang, 'ctrl.planmode.approved'));
    await clearKeyboard();
    await redeliver(key, replayMessage(chatId, threadId, request));
    return true;
  }

  log(`plan revision asked for ${key}`);
  await answer(t(lang, 'ctrl.planmode.kept'));
  await clearKeyboard();
  // Plan mode stays on, so `handle-message` asks for a plan again and the new
  // card carries a new id: the old one is stale from this moment.
  await redeliver(key, replayMessage(chatId, threadId, t(lang, 'ctrl.planmode.revised')));
  return true;
}
