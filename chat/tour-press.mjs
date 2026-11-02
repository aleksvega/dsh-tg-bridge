// One press inside the tour: next, back, or the command a card names.
//
// `tr:page:<n>` edits the card in place; `tr:run:<cmd>` hands the press to the
// ordinary command path, so a tour button is not a second implementation of the
// command it advertises.
import { runCommandFromButton } from '../core/run-command.mjs';
import { t } from '../core/i18n.mjs';
import { tg } from './telegram.mjs';
import { TRY, tourCard } from './tour.mjs';

export async function handleTourPress({ data, lang, chatId, threadId, messageId, answer }) {
  if (!String(data || '').startsWith('tr:')) return false;
  const body = String(data).slice(3);

  if (body === 'done') {
    await answer(t(lang, 'tour.done'));
    return true;
  }

  if (body.startsWith('run:')) {
    const cmd = body.slice(4);
    if (!TRY.includes(cmd)) {
      await answer(t(lang, 'tour.done'));
      return true;
    }
    await runCommandFromButton(`/${cmd}`, { chatId, threadId, lang });
    return true;
  }

  const step = Number(body.replace('page:', '')) || 1;
  const card = tourCard(step, lang);
  await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: card.text,
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: card.keyboard },
  }).catch(() => {});
  await answer(t(lang, 'tour.page', { n: Math.min(Math.max(step, 1), TRY.length), total: TRY.length }));
  return true;
}