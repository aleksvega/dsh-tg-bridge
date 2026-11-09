// The ↻ press's router half, out of the callback router for the same two
// reasons as the branch picker's: the router sits at the size ceiling, and the
// press is one idea — check the card against the live session, then type
// `/regen`, which stays the only implementation of a regeneration.
import { isRegenPress, regenPressState } from '../work/regen.mjs';
import { t } from '../core/i18n.mjs';
import { DSH_HOME } from '../core/paths.mjs';
import { state } from '../core/state.mjs';
import { tg } from './telegram.mjs';
import { sessionFile } from './thoughts.mjs';
import { activeTurns } from '../turn/turn.mjs';
import { join } from 'node:path';

/**
 * Handle one `rg:` press.
 *
 * @returns {Promise<boolean>} true when the press was this module's to answer.
 */
export async function handleRegenPress({ data, key, lang, chatId, threadId, messageId, answer, clearKeyboard, runCommandFromButton, log }) {
  if (!isRegenPress(data)) return false;
  const sessionId = state.sessions[key] || '';
  const sessionPath = sessionId ? sessionFile(join(DSH_HOME, 'sessions'), sessionId) : '';
  const check = regenPressState(data, { sessionId, busy: activeTurns.has(key), file: sessionPath });
  if (check.verdict === 'ok') {
    await clearKeyboard();
    await answer(t(lang, 'bridge.cb.done'));
    await runCommandFromButton('/regen', { chatId, threadId, key, lang });
  } else {
    // One line replaces the card: a stale card keeps nothing clickable.
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: t(lang, check.verdict === 'busy' ? 'ctrl.rewind.busy' : 'ctrl.rewind.stale'),
      reply_markup: { inline_keyboard: [] },
      ...(threadId > 0 ? { message_thread_id: threadId } : {}),
    }).catch(() => {});
    await answer(t(lang, 'bridge.cb.done'));
  }
  log(`regen press ${data} for ${key}`);
  return true;
}
