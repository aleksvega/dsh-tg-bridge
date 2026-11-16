// The one button `/voice` draws.
//
// Its own module because `callbacks.mjs` is at the ceiling and this press has a
// subject of its own: a tap changes one setting and redraws the card that shows
// it. A tap that toggled silently would leave the old words on screen, and the
// person would learn the truth only from the next answer's sound.
import { t } from '../core/i18n.mjs';
import { tgFast } from './telegram.mjs';
import { setSpeech, speechConfig } from './speech.mjs';
import { renderVoice, voiceKeyboard } from '../control/cmd-voice.mjs';

export function isVoicePress(data) {
  return data === 'v:on' || data === 'v:off';
}

/**
 * Flip the setting, answer the tap, redraw the card.
 *
 * `answer` is the caller's `answerCallbackQuery` wrapper: the press must stop
 * spinning, and only the caller owns the query id.
 */
export async function handleVoicePress({ data, query, state, key, config, lang, saveState, answer }) {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const on = data === 'v:on';
  const next = setSpeech(state, key, { on }, config, lang);
  saveState();
  await answer(t(lang, on ? 'ctrl.voice.tapOn' : 'ctrl.voice.tapOff'));
  await tgFast('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: renderVoice({ lang, ...next, voices: speechConfig(config).voices }),
    reply_markup: { inline_keyboard: voiceKeyboard(lang, next.on) },
  }).catch(() => {});
  return next;
}
