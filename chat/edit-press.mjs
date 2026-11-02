// A press on the `/edit` diff card: apply or cancel.
//
// The card is redrawn into the outcome, so the chat keeps one record of what
// happened to those lines instead of a dead card with two live-looking buttons.
// The press re-reads the file — see `applyEdit` — because a button carries a
// decision, not a copy of the file.
import { applyEdit, cancelEdit } from '../control/cmd-edit.mjs';
import { inlineKeyboard, tg } from './telegram.mjs';
import { t } from '../core/i18n.mjs';

/**
 * Handle one `ed:` press.
 *
 * @returns {Promise<boolean>} true when the press was this module's to answer.
 */
export async function handleEditPress({ data, key, lang, chatId, threadId, messageId, answer }) {
  if (!String(data || '').startsWith('ed:')) return false;
  const what = String(data).slice(3);
  // The outcome replaces the diff: the buttons are gone, so a second press has
  // nothing to hit, and the transcript shows the result where the question was.
  const settle = async (text) => {
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: { inline_keyboard: inlineKeyboard([]) },
    }).catch(() => {});
    await answer(text.split('\n')[0].slice(0, 180));
  };
  const ctx = { key, lang, chatId, threadId, answer, settle, reply: settle };
  if (what === 'a') return applyEdit(ctx);
  if (what === 'c') return cancelEdit(ctx);
  await answer(t(lang, 'ctrl.edit.stale'));
  return true;
}