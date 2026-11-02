// `/start`: the first thing a new person presses, and it used to be an error.
//
// Telegram puts a Start button on every bot. It sends `/start`, the bridge knew
// no such command, and the answer was "unknown command" — the worst possible
// first sentence, since the person had done nothing wrong. This is the answer
// instead: what the bot is, and the three commands that make it usable.
import { t } from '../core/i18n.mjs';
import { inlineKeyboard } from '../chat/telegram.mjs';
import { tourCard } from '../chat/tour.mjs';

export async function handleStartCommands(ctx) {
  const { effective, lang, reply } = ctx;
  if (effective !== '/start') return false;
  await reply(t(lang, 'start.body'), {
    reply_markup: { inline_keyboard: inlineKeyboard([[{ text: t(lang, 'tour.start'), data: 'tr:page:1' }]]) },
  });
  return true;
}