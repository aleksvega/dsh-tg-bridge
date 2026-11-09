// The 🌿 picker's router half. Kept out of the callback router because the
// router sits at the size ceiling, and because the picker is one idea: a
// press names a turn, the plan is rebuilt from the live session, and the
// action types the very command that does the work — `/fork` and
// `/branch new` stay the only implementations of a branch.
import { answerBranchPress, isBranchPress } from '../work/branch-buttons.mjs';
import { t } from '../core/i18n.mjs';
import { DSH_HOME } from '../core/paths.mjs';
import { state } from '../core/state.mjs';
import { tg } from './telegram.mjs';
import { sessionFile } from './thoughts.mjs';
import { activeTurns } from '../turn/turn.mjs';
import { join } from 'node:path';

/**
 * Handle one `bf:` press.
 *
 * @returns {Promise<boolean>} true when the press was this module's to answer.
 */
export async function handleBranchPress({ data, key, lang, chatId, threadId, messageId, answer, clearKeyboard, runCommandFromButton, log }) {
  if (!isBranchPress(data)) return false;
  const sessionId = state.sessions[key] || '';
  const sessionPath = sessionId ? sessionFile(join(DSH_HOME, 'sessions'), sessionId) : '';
  const done = answerBranchPress(data, {
    t: (k, vars) => t(lang, k, vars),
    ctx: { sessionId, busy: activeTurns.has(key), file: sessionPath },
  });
  if (done.command) {
    await clearKeyboard();
    await answer(t(lang, 'bridge.cb.done'));
    await runCommandFromButton(done.command, { chatId, threadId, key, lang });
  } else {
    // Either a confirm card replaces the picker, or one line replaces it —
    // a refused press leaves nothing clickable behind.
    const card = done.card || { text: done.line, keyboard: [] };
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: card.text,
      reply_markup: { inline_keyboard: card.keyboard },
      ...(threadId > 0 ? { message_thread_id: threadId } : {}),
    }).catch(() => {});
    await answer(t(lang, 'bridge.cb.done'));
  }
  log(`branch press ${data} for ${key}`);
  return true;
}
