// A `/find` or `/ls` result pressed: open the file at the matched line, walk
// into a folder, and page through either.
//
// Kept out of the callback router because the router was already at the size
// ceiling, and because this is the one place a press reads a file from disk: the
// fence, the preview and the "more" button belong together.
import { previewWindow } from './file-preview.mjs';
import { listDir, listingCard } from './file-listing.mjs';
import { t } from '../core/i18n.mjs';
import { saveState, state } from '../core/state.mjs';
import { inlineKeyboard, tg } from './telegram.mjs';

/**
 * Handle one `fs:` or `fv:` press.
 *
 * @returns {Promise<boolean>} true when the press was this module's to answer.
 */
export async function handleFilePress({ data, key, lang, chatId, threadId, messageId, answer }) {
  if (String(data || '').startsWith('fv:')) {
    return pressEntry({ data: String(data).slice(3), key, lang, chatId, threadId, messageId, answer });
  }
  if (!String(data || '').startsWith('fs:')) return false;
  const body = String(data).slice(3);
  if (body.startsWith('more:')) {
    const cur = state.preview?.[key];
    if (!cur) {
      await answer(t(lang, 'ctrl.find.stale'));
      return true;
    }
    const start = Number(body.slice(5)) || 0;
    const view = previewWindow({ root: cur.root, file: cur.file, line: cur.line, start, lang });
    if (view.refusal) {
      await answer(t(lang, `ctrl.find.file.${view.refusal}`));
      return true;
    }
    state.preview[key] = { ...cur, start };
    saveState();
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: view.text,
      reply_markup: { inline_keyboard: inlineKeyboard(view.keyboard) },
    }).catch(() => {});
    await answer(t(lang, 'ctrl.find.moreDone'));
    return true;
  }

  const found = state.find?.[key];
  const hit = found?.hits?.[Number(body)];
  if (!hit) {
    // A card older than the last search: its rows are gone, so naming that is
    // kinder than opening whatever now sits at that number.
    await answer(t(lang, 'ctrl.find.stale'));
    return true;
  }
  const view = previewWindow({ root: found.root, file: hit.file, line: hit.line, lang });
  if (view.refusal) {
    await answer(t(lang, `ctrl.find.file.${view.refusal}`));
    return true;
  }
  state.preview = state.preview || {};
  state.preview[key] = { root: found.root, file: hit.file, line: hit.line, start: 0 };
  saveState();
  await tg('sendMessage', {
    chat_id: chatId,
    ...(threadId > 0 ? { message_thread_id: threadId } : {}),
    text: view.text,
    reply_markup: { inline_keyboard: inlineKeyboard(view.keyboard) },
  }).catch(() => {});
  await answer(t(lang, 'ctrl.find.opened', { line: hit.line }));
  return true;
}

/** A `/ls` row pressed: walk into a folder, or open the file it named. */
async function pressEntry({ data, key, lang, chatId, threadId, messageId, answer }) {
  const cur = state.listing?.[key];
  const row = cur?.rows?.[Number(data)];
  if (!row) {
    await answer(t(lang, 'ctrl.ls.stale'));
    return true;
  }
  const rel = cur.dir && cur.dir !== '.' ? `${cur.dir}/${row.name}` : row.name;
  if (row.dir) {
    const result = listDir(cur.root, rel);
    if (result.refusal) {
      await answer(t(lang, `ctrl.find.${result.refusal}`, { root: cur.root }));
      return true;
    }
    state.listing[key] = { root: cur.root, dir: rel, rows: result.rows, at: Date.now() };
    saveState();
    const card = listingCard(rel, result, lang);
    // The folder replaces the card it was reached from, so walking back is one
    // `/ls ..` rather than a growing stack of messages in the chat.
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: card.text,
      reply_markup: { inline_keyboard: inlineKeyboard(card.keyboard) },
    }).catch(() => {});
    await answer(t(lang, 'ctrl.ls.entered', { dir: row.name }));
    return true;
  }
  const view = previewWindow({ root: cur.root, file: rel, line: 1, lang });
  if (view.refusal) {
    await answer(t(lang, `ctrl.find.file.${view.refusal}`));
    return true;
  }
  state.preview = state.preview || {};
  state.preview[key] = { root: cur.root, file: rel, line: 1, start: 0 };
  saveState();
  await tg('sendMessage', {
    chat_id: chatId,
    ...(threadId > 0 ? { message_thread_id: threadId } : {}),
    text: view.text,
    reply_markup: { inline_keyboard: inlineKeyboard(view.keyboard) },
  }).catch(() => {});
  await answer(t(lang, 'ctrl.ls.opened'));
  return true;
}