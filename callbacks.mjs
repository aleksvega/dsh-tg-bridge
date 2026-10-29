// Every button press: the router, the settings card, the rewind ticket, the
// task card. One place, because a press may mean a control command, a card
// update or an approval, and only one handler may claim it.
import { AgentsetStore } from './agentsets.mjs';
import { CONTROL_COMMANDS, handleControl } from './control.mjs';
import { isFallbackPress, pressTarget } from './fallback-card.mjs';
import { progressOf, toggleTask } from './goals.mjs';
import { handleMessage } from './handle-message.mjs';
import { resolveLang, t } from './i18n.mjs';
import { handleLoadPress } from './load-guard.mjs';
import { sessionKey } from './keys.mjs';
import { commandForName, isMenuPress, menuTarget, renderPanel, runsUnasked } from './menu-card.mjs';
import { DIR, DSH_HOME, LOG } from './paths.mjs';
import { approvals, enqueue, lastPrompt, maxParallel, redeliver, rewindUsed } from './queue.mjs';
import { answerRewindPress, cutSession, isRewindPress } from './rewind-buttons.mjs';
import { applyRewind, newestBackup, restoreBackup } from './rewind.mjs';
import { runCommandFromButton } from './run-command.mjs';
import { commandFor, renderSettingsCard, settingsCurrent } from './settings-card.mjs';
import { config, done, log, saveConfig, saveState, state } from './state.mjs';
import { inlineKeyboard, send, sendFile, tg } from './telegram.mjs';
import { sessionFile } from './thoughts.mjs';
import { activeTurns, killTurn, profileOf } from './turn.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Answer a button press: acknowledge, act, and describe the outcome. */
export async function handleCallback(query) {
  const data = String(query.data || '');
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const threadId = query.message?.message_thread_id ?? 0;
  const key = sessionKey(chatId, threadId);
  const lang = resolveLang(state, key, null, config);
  const answer = (text, show = false) =>
    tg('answerCallbackQuery', { callback_query_id: query.id, text, show_alert: show }).catch(() => {});

  // A button is a message without a sender the rest of the code can check, and
  // the chat itself may be a group. Anything that changes configuration must
  // come from an allowed user, exactly like the message path at the top of the
  // poll loop. The refusal is deliberately the same as "unknown button".
  const presser = query.from?.id;
  if (!config.allowedUserIds.includes(presser) && !config.allowedUserIds.includes(chatId)) {
    log(`ignored callback from ${presser} (chat ${chatId})`);
    await answer(t(lang, 'bridge.cb.unknown'));
    return;
  }

  // Trim the buttons of the pressed message first: a button that already did
  // its job must not be pressable a second time.
  const clearKeyboard = () =>
    tg('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});

  if (data.startsWith('m:')) {
    // The settings card. Its own answer path, because a tap that redraws or
    // flips one setting must not go through the defaults below (`clearKeyboard`
    // would strip the tabs it is about to draw again).
    await handleCardPress(query, { chatId, messageId, threadId, key, lang });
    return;
  }

  if (isRewindPress(data)) {
    // A rewind button. What it acts on is read here, not taken from the card:
    // between drawing "go back 2" and the press, the session may have moved on,
    // and the answer says so instead of cutting the wrong turns.
    const sessionId = state.sessions[key] || '';
    const sessionPath = sessionId ? sessionFile(join(DSH_HOME, 'sessions'), sessionId) : '';
    const line = answerRewindPress(data, {
      used: rewindUsed,
      lang,
      t,
      ctx: {
        sessionId,
        busy: activeTurns.has(key),
        file: sessionPath,
        cut: (steps) => cutSession(sessionPath, steps, applyRewind),
        undo: () => {
          const backup = newestBackup(sessionPath);
          if (!backup) return { error: 'nothing' };
          try {
            restoreBackup(backup, sessionPath);
            return { backup };
          } catch (error) {
            return { error: error.message };
          }
        },
      },
    });
    // The card becomes the one line answering the press, and keeps no buttons.
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: line,
      reply_markup: { inline_keyboard: [] },
      ...(threadId > 0 ? { message_thread_id: threadId } : {}),
    }).catch(() => {});
    await answer(t(lang, 'bridge.cb.done'));
    log(`rewind press ${data} for ${key}`);
    return;
  }

  // A search result's plus button. The name came from the registry and the
  // command is the one the hint under the list names, so a tap installs exactly
  // what was read — no hidden second path into pnpm.
  if (data.startsWith('pl:i:')) {
    const wanted = data.slice(5);
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(wanted)) {
      await answer(t(lang, 'bridge.cb.unknown'));
      return;
    }
    await clearKeyboard();
    await answer(`/plugin add ${wanted}`);
    log(`plugin install via button: ${wanted}`);
    await runCommandFromButton(`/plugin add ${wanted}`, { chatId, threadId, key, lang });
    return;
  }

  // The up arrow on the update card. Same shape as the plus of a search result:
  // the name was printed by the command that read the registry, and the tap runs
  // `/plugin update <name>` — nothing else.
  if (data.startsWith('pl:u:')) {
    const wanted = data.slice(5);
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(wanted)) {
      await answer(t(lang, 'bridge.cb.unknown'));
      return;
    }
    await clearKeyboard();
    await answer(`/plugin update ${wanted}`);
    log(`plugin update via button: ${wanted}`);
    await runCommandFromButton(`/plugin update ${wanted}`, { chatId, threadId, key, lang });
    return;
  }

  if (data.startsWith('fk:')) {
    // A branch button from /branches. It does what `/resume <id>` does, so the
    // topic moves onto that branch and the answer comes from the command
    // itself — one implementation, one sentence.
    const wanted = data.slice(3);
    if (!/^session-[0-9a-f-]{36}$/.test(wanted)) {
      await answer(t(lang, 'bridge.cb.unknown'));
      return;
    }
    await clearKeyboard();
    await runCommandFromButton(`/resume ${wanted.slice(8)}`, { chatId, threadId, key, lang });
    return;
  }

  // A parallel-slot button from the /jobs card. It runs the command the card
  // advertises, so validation and storage live in one place and a tap cannot
  // write a value `/jobs <n>` would refuse. The command redraws the card, so the
  // answer to the press is the new state, not a second message about it.
  if (data.startsWith('jb:')) {
    await clearKeyboard();
    await runCommandFromButton(`/jobs ${data.slice(3)}`, { chatId, threadId, key });
    return;
  }

  // A button on the load card, or on the notice that held a prompt back. Both
  // are `/load` verbs, so the tap and the typed command run the same code.
  if (data.startsWith('ld:')) {
    await handleLoadPress({ data, key, t, lang, answer, clearKeyboard, redeliver, runCommandFromButton, chatId, threadId, log });
    return;
  }

  // A button on the failover card. Every press becomes the verb of `/fallback`,
  // so a tap and a typed line land in the same code — and the command redraws the
  // card, which is why the old keyboard is trimmed only when the press leaves it.
  if (isFallbackPress(data)) {
    const target = pressTarget(data);
    const words = { t: 'toggle', u: 'up', d: 'down', x: 'test', e: 'chain', s: 'show' };
    // `r` is two verbs on one letter: with a number it removes that route, alone
    // it opens the remove list. Anything else is a stale card and does nothing.
    const verb = target && (target.verb === 'r' ? (target.n ? 'remove' : 'menu') : words[target.verb]);
    if (!verb) {
      await answer(t(lang, 'bridge.cb.unknown'));
      return;
    }
    const typed = target.n && verb !== 'menu' ? `/fallback ${verb} ${target.n}` : `/fallback ${verb}`;
    await clearKeyboard();
    await answer(typed);
    log(`fallback press ${typed} for ${key}`);
    await runCommandFromButton(typed, { chatId, threadId, key, lang });
    return;
  }

  if (isMenuPress(data)) {
    // The panel is a set of cards: the hub, then one page per section. Moving
    // between them edits this message, so browsing costs no new messages. A
    // command press is exactly a typed command, so it goes through the same
    // `handleControl`; the card is replaced by whatever that command answers.
    const target = menuTarget(data);
    if (target.kind === 'hub' || target.kind === 'section') {
      const card = renderPanel({ t: (k, v) => t(lang, k, v), page: target.page || '' });
      await tg('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: card.text,
        reply_markup: { inline_keyboard: inlineKeyboard(card.keyboard) },
        ...(threadId > 0 ? { message_thread_id: threadId } : {}),
      }).catch(() => {});
      await answer(t(lang, 'bridge.cb.done'));
      return;
    }
    if (target.kind === 'close') {
      // The card collapses into one line that can be deleted by hand, and the
      // buttons go with it: a panel that stays open is a panel that lies about
      // being closed.
      await tg('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: t(lang, 'ctrl.menu.closed'),
        reply_markup: { inline_keyboard: [] },
        ...(threadId > 0 ? { thread_id: threadId, message_thread_id: threadId } : {}),
      }).catch(() => {});
      await answer(t(lang, 'ctrl.menu.closedToast'));
      log(`menu closed for ${key}`);
      return;
    }
    const name = target.kind === 'command' ? target.name : '';
    await clearKeyboard();
    // `/new` and `/stop` change something when typed alone, and a stray tap on
    // them is a command nobody asked for — so they open their explanation.
    const typed = runsUnasked(name) && CONTROL_COMMANDS.includes(name)
      ? commandForName(name, { t: (k, v) => t(lang, k, v) })
      : `/help ${name}`;
    await answer(typed || t(lang, 'bridge.cb.unknown'));
    if (!typed) return;
    log(`menu press /${name} for ${key}`);
    await runCommandFromButton(typed, { chatId, threadId, key, lang });
    return;
  }

  if (data === 'stop') {
    const killed = killTurn(key);
    await clearKeyboard();
    await answer(t(lang, killed ? 'bridge.cb.stopping' : 'bridge.cb.nothingToStop'));
    log(`stop via button for ${key}: ${killed ? 'killed' : 'nothing'}`);
    if (killed) await send(chatId, t(lang, 'bridge.cb.turnStopped'), threadId);
    return;
  }

  if (data === 'logs') {
    await answer(t(lang, 'bridge.cb.showingLog'));
    try {
      const lines = readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean).slice(-12);
      await send(chatId, lines.join('\n') || t(lang, 'bridge.cb.logEmpty'), threadId);
    } catch (error) {
      await send(chatId, t(lang, 'bridge.cb.logUnreadable', { err: error.message }), threadId);
    }
    return;
  }

  if (data === 'doctor') {
    await answer(t(lang, 'bridge.cb.checking'));
    await send(chatId, t(lang, 'bridge.cb.doctorHint'), threadId);
    return;
  }

  if (data === 'resume') {
    // Not a retry: the session already holds everything the turn produced.
    // A continuation prompt asks the agent to check the state and go on.
    await clearKeyboard();
    await answer(t(lang, 'btn.continue'));
    log(`resume via button for ${key}`);
    const thread = threadId || 0;
    enqueue(key, () => handleMessage({
      chat: { id: chatId },
      from: { id: config.allowedUserIds[0] },
      message_id: 0,
      message_thread_id: thread || undefined,
      is_topic_message: thread > 0,
      text: t(lang, 'prompt.continueTurn'),
    }));
    return;
  }

  if (data === 'retry') {
    const original = lastPrompt.get(key);
    if (!original) {
      await answer(t(lang, 'bridge.cb.nothingToRetry'));
      await clearKeyboard();
      return;
    }
    await clearKeyboard();
    await answer(t(lang, 'bridge.cb.retrying'));
    log(`retry via button for ${key}`);
    enqueue(key, () => handleMessage({ ...original, message_id: original.message_id }));
    return;
  }

  if (data.startsWith('t:')) {
    // A task card. The whole message is redrawn from state, so a double tap or
    // two people pressing converge on one truth instead of stacking ✅ marks.
    const n = Number(data.slice(2));
    const goal = toggleTask(state, key, n);
    if (!goal) {
      await answer(t(lang, 'bridge.cb.taskStale'));
      return;
    }
    saveState();
    const text = renderTaskCard(goal, lang);
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: { inline_keyboard: inlineKeyboard(taskRows(goal)) },
    }).catch(() => {});
    await answer(t(lang, goal.tasks[n - 1]?.done ? 'bridge.cb.taskDone' : 'bridge.cb.taskUndone'));
    log(`task ${n} toggled for ${key}`);
    return;
  }

  if (data.startsWith('ap:')) {
    const [, verdict, requestId] = data.split(':');
    const pending = approvals.get(requestId);
    if (!pending) {
      await answer(t(lang, 'bridge.cb.approvalStale'));
      await clearKeyboard();
      return;
    }
    clearTimeout(pending.timer);
    approvals.delete(requestId);
    await clearKeyboard();
    const allowed = verdict === 'y' || verdict === 'a';
    const remember = verdict === 'a';
    pending.resolve({ allowed, remember, expired: false });
    await answer(t(lang, allowed ? (remember ? 'bridge.cb.allowedAlways' : 'bridge.cb.allowed') : 'bridge.cb.denied'));
    log(`approval ${verdict} for request ${requestId}`);
    return;
  }

  await answer(t(lang, 'bridge.cb.unknown'));
}

export async function handleCardPress(query, ctx) {
  const { chatId, messageId, threadId, key, lang } = ctx;
  const data = String(query.data || '');
  const tt = (k, vars) => t(lang, k, vars);
  const updateMode = state.update?.mode || 'check';
  const current = settingsCurrent({ config, state, key });
  const wanted = commandFor({ t: tt, current, updateMode }, data);

  if (!wanted) {
    await tg('answerCallbackQuery', { callback_query_id: query.id, text: t(lang, 'settings.card.stale') }).catch(() => {});
    return;
  }

  if (wanted.done) {
    await tg('deleteMessage', { chat_id: chatId, message_id: messageId }).catch((error) => log(`settings card delete failed: ${error.message}`));
    await tg('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
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
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: card.text,
      reply_markup: { inline_keyboard: inlineKeyboard(card.keyboard) },
      ...(threadId > 0 ? { message_thread_id: threadId } : {}),
    }).catch((error) => {
      const why = String(error.message || '');
      // Tapping the tab you are already on is not a failure: Telegram refuses an
      // edit that changes nothing, and the card is already what the press asked
      // for. Logging it as a failure made a working tap look broken.
      if (!/message is not modified/i.test(why)) log(`settings card redraw failed: ${why}`);
    });
    await tg('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
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
    profile: profileOf(key),
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

/**
 * A task list as one message plus one button per task. The label carries the
 * state, the payload carries only the number, so the card survives a relabel and
 * stays inside Telegram's 64-byte callback limit.
 */
export function renderTaskCard(goal, lang) {
  const { done, total } = progressOf(goal);
  const lines = [t(lang, 'goal.set', { text: goal.text })];
  goal.tasks.forEach((task, i) => lines.push(`${task.done ? '✅' : '⬜'} ${i + 1}. ${task.text}`));
  lines.push(t(lang, 'goal.progress', { done, total }), '', t(lang, 'task.tapHint'));
  return lines.join('\n');
}

export function taskRows(goal) {
  if (!goal || goal.done) return [];
  const rows = [];
  for (let i = 0; i < Math.min(goal.tasks.length, 90); i += 3) {
    rows.push(goal.tasks.slice(i, i + 3).map((task, k) => ({ text: `${task.done ? '✅' : '⬜'} ${i + k + 1}`, data: `t:${i + k + 1}` })));
  }
  return rows;
}
