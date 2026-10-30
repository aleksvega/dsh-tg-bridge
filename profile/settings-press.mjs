// One press on the settings card: a tab, a switch, a door.
//
// The router in `callbacks.mjs` decides that a payload starts with `m:` and comes
// here. That keeps the router a router and this file the one place that knows
// what the card's rows mean — and it keeps both under the 500-line ceiling the
// repository enforces, which is what pulled this out of the router in the first
// place.
//
// Two rules hold for every path below, and they are the reason the code is
// shaped like this rather than shorter:
//
// - A press says something. Every path ends in `answer(...)`, and that call is
//   what reports the output to the guard the router created — a press that
//   fails, hangs or finds a stale button is never mistaken for a dead menu.
// - A press is fast. Every call here is `tgFast`: a card lives inside a tap, and
//   the person watching it will not wait the three minutes `tg` allows.
import { AgentsetStore } from './agentsets.mjs';
import { handleControl } from '../chat/control.mjs';
import { t } from '../core/i18n.mjs';
import { DIR } from '../core/paths.mjs';
import { maxParallel } from '../turn/queue.mjs';
import { commandFor, renderSettingsCard, settingsCurrent } from './settings-card.mjs';
import { config, log, saveConfig, saveState, state } from '../core/state.mjs';
import { inlineKeyboard, send, tg, tgFast } from '../chat/telegram.mjs';
import { activeTurns, baseProfileOf } from '../turn/turn.mjs';
import { join } from 'node:path';

export async function handleCardPress(query, ctx) {
  const { chatId, messageId, threadId, key, lang } = ctx;
  const data = String(query.data || '');
  const tt = (k, vars) => t(lang, k, vars);
  const updateMode = state.update?.mode || 'check';
  const current = settingsCurrent({ config, state, key });
  const wanted = commandFor({ t: tt, current, updateMode }, data);
  // The press answers through the caller's guard when there is one, so the
  // "did this press say anything" count is kept in a single place.
  const answer =
    ctx.answer ??
    ((text, show = false) => tgFast('answerCallbackQuery', { callback_query_id: query.id, text, show_alert: show }).catch(() => false));

  if (!wanted) {
    log(`settings press ${data}: stale button, the card no longer has it`);
    await answer(t(lang, 'settings.card.stale'), true);
    return;
  }

  if (wanted.done) {
    await tgFast('deleteMessage', { chat_id: chatId, message_id: messageId }).catch((error) => log(`settings card delete failed: ${error.message}`));
    await answer('');
    return;
  }

  /** Redraw the card in place: the same message, the new values, the buttons kept. */
  const redraw = async (page, note = '') => {
    const card = renderSettingsCard({
      page,
      t: tt,
      current: settingsCurrent({ config, state, key }),
      updateMode,
      bound: boundSetOf(key),
      note,
    });
    let same = false;
    await tgFast('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: card.text,
      reply_markup: { inline_keyboard: inlineKeyboard(card.keyboard) },
      ...(threadId > 0 ? { message_thread_id: threadId } : {}),
    }).catch((error) => {
      const why = String(error.message || '');
      // Tapping the value already in force is not a failure: Telegram refuses an
      // edit that changes nothing, and the card is already what the press asked
      // for. It is still worth a word, because the person pressed a live button
      // and silence is what a broken card looks like.
      if (/message is not modified/i.test(why)) {
        same = true;
        log(`settings card ${page}: already showed that`);
      } else {
        log(`settings card redraw failed: ${why}`);
      }
    });
    await answer(same ? t(lang, 'settings.card.same') : '');
  };

  if (wanted.tab) {
    await redraw(wanted.page);
    return;
  }

  // Run the command. Whatever it answers goes in the log and, by default, not
  // in the chat: the one line below is the chat's share of this press. Only a
  // command that failed says more than that.
  const replies = [];
  // A press that fails has to say so: the card is redrawn either way, and a
  // redraw alone looks exactly like success. The old path hid failures behind a
  // line the person read as a confirmation.
  let failed = '';
  const [head, ...rest] = wanted.command.split(/\s+/);
  const handled = await handleControl({
    command: head,
    arg: rest.join(' '),
    text: wanted.command,
    lang,
    chatId,
    threadId,
    key,
    state,
    config,
    activeTurns,
    saveState,
    // `/fallback` writes config.json; without this the press would look applied
    // and vanish on restart, which is the worst of both answers.
    saveConfig,
    log,
    send: (text) => {
      replies.push(String(text ?? ''));
      return Promise.resolve(0);
    },
    reply: (text) => {
      replies.push(String(text ?? ''));
      return Promise.resolve(0);
    },
    jobs: () => ({ active: [], queued: 0, max: maxParallel() }),
    api: tg,
    sendFile: () => Promise.resolve(0),
    profile: baseProfileOf(key),
    prices: () => Promise.resolve(''),
  }).catch((error) => {
    log(`settings press ${data} failed: ${error.message}`);
    failed = error.message;
    replies.push(error.message);
    return true;
  });

  const changed = Boolean(wanted.value);

  // The card stays where it is, redrawn with the new value. A press that turned
  // it into one line took the menu away from the person who wanted the next tap,
  // and the line said less than the card did; keeping it costs no message,
  // because this is an edit of the one already in the chat. The way out is the
  // card's own button, so removing it is a decision, not a side effect.
  await redraw(
    wanted.page,
    failed ? `⚠️ ${failed}` : changed ? t(lang, 'settings.card.changed', { label: wanted.label, value: wanted.value }) : '',
  );

  // A door that opened to nothing (an unknown set id, a command that is not
  // allowed here) still has something to say; it goes under the card, once. A
  // switch says nothing here: the card above it already named the new value, and
  // a failure is on the card too, so it is not repeated below it.
  if (!handled) log(`settings press ${data}: no handler answered`);
  const notLine = replies.filter(Boolean).filter((r) => r !== wanted.command);
  if (notLine.length > 0 && !changed && !failed) {
    await send(chatId, notLine[0], threadId).catch(() => {});
  }
}

/**
 * The set bound to this topic, for the card that names it. Read through the
 * agentset store the commands use, so the card never keeps a second copy.
 */
export function boundSetOf(key) {
  const id = state.agentsets?.[key];
  if (!id) return null;
  try {
    return new AgentsetStore(join(DIR, 'agentsets.json')).load().get(id) || null;
  } catch {
    return null;
  }
}
