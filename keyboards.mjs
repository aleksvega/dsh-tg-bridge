// The buttons that ride on a status message.
//
// Pure data: every keyboard here is a function of a language and, for approvals,
// a request id. No module state, no API calls — which is why both the progress
// panel and the callback handlers can build the same button without either one
// owning the other.
import { t } from './i18n.mjs';

/** A failed turn: retry it, or run the doctor. */
export function errorKeyboard(key, lang = 'en') {
  return {
    inline_keyboard: [
      [
        { text: `🔁 ${t(lang, 'btn.retry')}`, callback_data: 'retry' },
        { text: `🩺 ${t(lang, 'btn.doctor')}`, callback_data: 'doctor' },
      ],
    ],
  };
}

/** A turn stopped by the clock: the work is not lost, so offer to go on. */
export function continueKeyboard(key, lang = 'en') {
  return {
    inline_keyboard: [
      [
        { text: `⏵ ${t(lang, 'btn.continue')}`, callback_data: 'resume' },
        { text: `🩺 ${t(lang, 'btn.doctor')}`, callback_data: 'doctor' },
      ],
    ],
  };
}

export function approvalKeyboard(requestId, lang = 'en') {
  return {
    inline_keyboard: [
      [
        { text: t(lang, 'bridge.approval.allow'), callback_data: `ap:y:${requestId}` },
        { text: t(lang, 'bridge.approval.deny'), callback_data: `ap:n:${requestId}` },
      ],
      [{ text: t(lang, 'bridge.approval.always'), callback_data: `ap:a:${requestId}` }],
    ],
  };
}
