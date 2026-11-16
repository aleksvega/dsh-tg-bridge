// `/voice` — читать ответы вслух или молчать.
//
// Просьба человека: «иногда я не могу читать, буду слушать» — то есть это
// переключатель на тему, а не настройка установки. Живёт рядом с `state.lang`:
// у каждой темы свой ответ, потому что в одной человек слушает, а в другой
// смотрит код.
//
// Ответ на команду сразу говорит две вещи: включено ли и каким голосом. Голос
// можно назвать словом (`/voice on ru-RU-DmitryNeural`) — движок берётся из
// конфига, поэтому список голосов задаёт провайдер, а не мы.
import { t } from '../core/i18n.mjs';
import { inlineKeyboard } from '../chat/telegram.mjs';
import { DEFAULT_VOICES, setSpeech, speechConfig, speechOf } from '../chat/speech.mjs';

/**
 * Кнопки карточки. `v:on` / `v:off` ловит `callbacks.mjs`, чтобы нажатие не
 * стоило хода модели.
 */
export function voiceKeyboard(lang, on) {
  return inlineKeyboard([
    [{ text: t(lang, on ? 'ctrl.voice.off' : 'ctrl.voice.on'), data: on ? 'v:off' : 'v:on' }],
  ]);
}

/** Текст карточки: состояние, голос, как позвать. */
export function renderVoice({ lang, on, voice, voices }) {
  const lines = [
    t(lang, 'ctrl.voice.head'),
    t(lang, on ? 'ctrl.voice.stateOn' : 'ctrl.voice.stateOff'),
    t(lang, 'ctrl.voice.voice', { voice }),
  ];
  // Полный список — только когда его просят: три строки в карточке лучше, чем
  // стена имён, которую никто не читает.
  const known = Object.values(voices).filter(Boolean);
  if (known.length > 1) lines.push(t(lang, 'ctrl.voice.byLang', { list: known.join(', ') }));
  lines.push(t(lang, 'ctrl.voice.hint'));
  return lines.join(String.fromCharCode(10));
}

/**
 * Переключить голос и вернуть новое состояние. Одна функция на команду и на
 * кнопку: два пути к одной настройке разошлись бы в первый же месяц.
 */
export function toggleSpeech(state, key, config, lang, on) {
  return setSpeech(state, key, { on }, config, lang);
}

export async function handleVoiceCommands(ctx) {
  const { effective, arg, lang, reply, state, key, config } = ctx;
  if (effective !== '/voice') return false;
  const cfg = speechConfig(config);
  const current = speechOf(state, key, config, lang);
  const word = String(arg || '').trim();
  const lower = word.toLowerCase();

  if (!word || lower === 'status') {
    await reply(renderVoice({ lang, ...current, voices: cfg.voices }), {
      keyboard: voiceKeyboard(lang, current.on),
    });
    return true;
  }
  if (lower === 'on' || lower === 'off') {
    const next = toggleSpeech(state, key, config, lang, lower === 'on');
    await reply(renderVoice({ lang, ...next, voices: cfg.voices }), {
      keyboard: voiceKeyboard(lang, next.on),
    });
    return true;
  }
  // Любое другое слово — имя голоса: так человек меняет голос, не открывая
  // конфиг, и опечатка не выключает звук молча.
  const next = setSpeech(state, key, { voice: word, on: true }, config, lang);
  await reply(renderVoice({ lang, ...next, voices: cfg.voices }), {
    keyboard: voiceKeyboard(lang, next.on),
  });
  return true;
}

export { DEFAULT_VOICES };
