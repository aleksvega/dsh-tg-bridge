// One incoming message becomes one turn.
//
// The largest single piece of the bridge on purpose: it is the one place that
// knows what a message is (text, photo, album, button-sized command) and how a
// topic's session, profile, request and progress panel fit together. Everything
// it calls lives in a module of its own.

import { GENERAL_SAFE, commandOf } from './commands.mjs';
import { CONTROL_COMMANDS, handleControl, modelOf } from './control.mjs';
import { reasoningMode } from './notes.mjs';
import { explainFailure } from '../turn/failures.mjs';
import { runFallbackChain } from '../model/fallback.mjs';
import { goalOf, renderPromptBlock } from '../work/goals.mjs';
import { resolveLang, t } from '../core/i18n.mjs';
import { sessionKey, threadOf } from '../core/keys.mjs';
import { holdIfLoaded } from '../work/load-guard.mjs';
import { guardOf } from '../core/machine.mjs';
import { mediaPrompt } from './media.mjs';
import { keyboardCommand } from './menu-card.mjs';
import { looksLikeReasoning } from './panel.mjs';
import { QUIET_MS, quietGuard } from './quiet-guard.mjs';
import { DIR, GOAL_CMD, THOUGHT_DIR } from '../core/paths.mjs';
import { renderPrices } from '../model/prices.mjs';
import { settingsChipOf, turnPlan } from '../profile/profile-view.mjs';
import { startProgress } from '../turn/progress.mjs';
import { reportRefusals } from '../profile/sandbox-note.mjs';
import { noteTurn } from '../core/stability.mjs';
import { makeTurnEvents, newTelemetry, noteAnswered } from '../turn/turn-events.mjs';
import { lastPrompt, maxParallel, queues } from '../turn/queue.mjs';
import { token } from '../core/secrets.mjs';
import { config, done, log, saveConfig, saveState, state } from '../core/state.mjs';
import { send, sendEphemeral, sendFile, sendWithMarkup, tg } from './telegram.mjs';
import { ensureTopicSeed, logTopicToGeneral, newestBoundTopic, startTopicFromMessage, topicName, topicSeeded, topicSeededRecently, touchTopic } from './topics.mjs';
import { activeTurns, killTurn, liveSessions, profileOf, runTurnLive, turnAttempt, turnStartedAt, typingLoop } from '../turn/turn.mjs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export async function handleMessage(msg, album = null) {
  const chatId = msg.chat.id;
  const from = msg.from?.id;

  // 1. Never react to our own output: the bot's seeded topic message comes back
  //    through getUpdates as a normal group message and used to start a turn.
  if (msg.from?.is_bot) {
    log(`ignored own/service message from bot ${from} (chat ${chatId})`);
    return;
  }
  // 2. Service messages (topic created, pins, joins) carry no task text.
  const attachments = album && album.length ? album : [msg];
  if (!msg.text && !msg.caption && !attachments.some((m) => m.voice || m.audio || m.photo || m.document || m.video || m.video_note || m.animation)) {
    log(`ignored service message chat=${chatId} thread=${msg.message_thread_id ?? 0}`);
    return;
  }

  let threadId = threadOf(msg);
  // Whether the person typed in the General topic (the "All" stream), before the
  // lobby rule below moves the message into a topic.
  const typedInGeneral = threadId === 0;
  // 3. The General-chat twin of an already-seeded topic: keep the log line,
  //    skip the turn — the topic message already owns this work.
  const twin = threadId === 0 ? topicSeededRecently(msg.text ?? msg.caption ?? '') : 0;
  if (twin > 0) {
    log(`duplicate of topic ${twin} seen in General; answering in the topic instead`);
    threadId = twin;
  }

  // 4. Lobby rule: the General thread is where topics are started, not where
  //    work runs. A prompt written there used to be moved into the most
  //    recently active topic, which silently dropped it into another project's
  //    conversation — the owner hit that twice. Now the prompt opens a topic of
  //    its own, named from its first words, with the person's message copied in
  //    as the first message and pinned.
  //
  //    Commands are not prompts: `/status` typed in General asks about the
  //    bridge, it does not start a project. They keep the old recovery, and the
  //    guard below still refuses a state-changing one.
  if (threadId === 0 && config.generalLobby !== false) {
    const raw = (msg.text || msg.caption || '').trim();
    const looksLikeCommand = raw.startsWith('/');
    if (!looksLikeCommand && raw) {
      const started = await startTopicFromMessage(chatId, msg, raw);
      if (started > 0) {
        threadId = started;
        log(`General prompt started topic ${threadId}`);
      }
    }
    if (threadId === 0) {
      const recovered = newestBoundTopic(chatId);
      if (recovered > 0) {
        log(`General message recovered into topic ${recovered}`);
        threadId = recovered;
      }
    }
  }
  // The topic a General message was moved into, or 0 when it stayed where it was.
  const recoveredTopic = typedInGeneral && threadId > 0 ? threadId : 0;
  touchTopic(threadId);

  const key = sessionKey(chatId, threadId);
  // Language for everything this turn shows: topic choice, config, then Telegram.
  const learned = !state.lang?.[key];
  const lang = resolveLang(state, key, msg, config);
  // First message in a topic teaches the bridge what it speaks, and the button
  // presses that follow have no message of their own — keep the answer.
  if (learned && state.lang?.[key]) saveState();
  const where = `${chatId}${threadId ? ` topic=${threadId}` : ''}`;
  if (!config.allowedUserIds.includes(from) && !config.allowedUserIds.includes(chatId)) {
    log(`ignored message from ${from} (chat ${chatId})`);
    return;
  }
  let text = (msg.text || msg.caption || '').trim();
  // Voice notes, audio files, photos and documents: transcribe or download
  // locally, then treat the resulting text exactly like typed text. The same
  // helper feeds the mid-turn steer path, so an attachment means the same
  // thing whether the turn is idle or already running.
  //
  // A file almost always arrives with a caption, so the presence of text must
  // not be taken as "no attachment": that dropped every captioned document.
  let extraArgs = [];
  let turnProfile = '';
  if (!msg.text && attachments.some((m) => m.voice || m.audio || m.photo || m.document || m.video || m.video_note || m.animation)) {
    const built = await mediaPrompt(attachments, chatId, threadId, lang);
    if (built.text) text = built.text;
    extraArgs = built.extraArgs;
    turnProfile = built.profile || '';
  }
  if (!text) return;
  log(`in ${where} from=${from} len=${text.length}${msg.is_topic_message ? ' topic-message' : ''}`);
  // A bound set replaces the profile for this turn only: the media route above
  // still wins, because it carries a per-turn model the person chose out loud.
  //
  // The plan also decides the sandbox boundary. When it comes back with an
  // error the turn does not start: a set that asks for a narrower policy on a
  // profile that cannot express one would otherwise run under the WIDE policy
  // and look like it worked, which is the bug this whole change exists for.
  if (!turnProfile) {
    const plan = turnPlan(key);
    if (plan.error) {
      log(`turn refused for ${where}: ${plan.error}`);
      await send(chatId, t(lang, 'bridge.turn.noPolicy', { reason: plan.error }), threadId);
      return;
    }
    turnProfile = plan.profile;
  }

  // A brand-new forum topic starts empty: the title says what the person wants
  // but the thread itself has no message, so scrolling back shows a blank
  // hole. Seed it with the incoming text and pin the seed, which also pins the
  // topic to the top of the list — the owner asked for exactly that.
  //
  // Seeding runs once per topic: a message written inside an existing topic is
  // already visible there, and seeding it again would duplicate the person's
  // own words.
  if (threadId > 0 && msg.is_topic_message && !topicSeeded(threadId)) {
    const seed = await ensureTopicSeed(chatId, threadId, text);
    if (seed) {
      log(`topic ${threadId} seeded with message=${seed}`);
      await logTopicToGeneral(chatId, threadId, text, lang);
    }
  }

  // A tap on the persistent keyboard (`/menu on`) arrives as its own label,
  // with no slash: "Меню", "Статус", "Стоп", "Новый". Only while the keyboard is
  // on — the same word typed by hand is a prompt, not a command. The label is
  // matched in every language, because the keyboard outlives a /lang switch.
  if (state.menu?.[key]) {
    const mapped = ['ru', 'en', 'zh']
      .map((code) => keyboardCommand(text, { t: (k, v) => t(code, k, v) }))
      .find(Boolean);
    if (mapped) {
      log(`menu key "${text}" -> ${mapped} for ${key}`);
      text = mapped;
    }
  }

  const space = text.indexOf(' ');
  const head = space === -1 ? text : text.slice(0, space);
  const command = commandOf(head);
  const arg = space === -1 ? '' : text.slice(space + 1).trim();

  // `/apprestart.confirm` (no space) is a real way to mistype the service
  // command and used to fall through to a full AI turn. Map the collapsed
  // forms onto the canonical command + argument instead.
  //
  // Heads are matched WITHOUT their punctuation, so `/apprestart.confirm` and
  // `/app-restart-confirm` both arrive here as "apprestartconfirm".
  const collapsed = command.replace(/^\//, '').replace(/[.-]+/g, '');
  const known = new Set(CONTROL_COMMANDS);
  let effective = known.has(collapsed) ? `/${collapsed}` : '';
  let effectiveArg = arg;
  if (collapsed === 'apprestart' || collapsed === 'apprestartconfirm') {
    effective = '/app';
    // The dotted/solid form already says "restart", so confirm is the only
    // missing word: `/apprestart.confirm` must mean `/app restart confirm`.
    effectiveArg = arg || 'restart confirm';
  } else if (collapsed === 'restartconfirm') {
    effective = '/restart';
    effectiveArg = arg || 'confirm';
  }
  if (effective && effective !== command) {
    log(`command alias: ${head} -> ${effective} ${effectiveArg}`);
  }
  if (effectiveArg === 'restartconfirm' || effectiveArg === 'restart.confirm') effectiveArg = 'restart confirm';

  // General is the lobby: a prompt written there runs in the most recently active
  // topic so one project stays in one place. A command that CHANGES things must
  // not silently change a topic the person is not looking at — `/new` there wiped
  // the session of another topic and `/rewind` rolled one back, and the answer
  // appeared in that topic rather than where it was typed. Reading commands and
  // `/stop` still follow the work, because that is what the lobby is for.
  if (recoveredTopic > 0 && effective && !GENERAL_SAFE.has(effective.slice(1))) {
    const named = topicName(chatId, recoveredTopic) || `#${recoveredTopic}`;
    log(`refused ${effective} in General; it belongs to topic ${recoveredTopic}`);
    await send(chatId, t(lang, 'msg.generalGuard', { cmd: effective, topic: named }), 0);
    return;
  }

  // An unknown slash command must never become an AI turn: it burns money and
  // answers something the person did not ask. Answer with the menu instead.
  if (command && !effective) {
    log(`unknown command ${head} from ${from}`);
    // Ephemeral: a mistyped command is usually a typo of a real one, so the menu
    // appears long enough to pick from it and then clears itself.
    await sendEphemeral(
      chatId,
      `${t(lang, 'msg.unknownCommand', { cmd: head })}

${t(lang, 'help.body')}`,
      threadId,
      msg.message_id
    );
    return;
  }

  if (effective) {
    // A command that says nothing is a menu that looks dead. The guard speaks
    // once if the window passes with no output, and falls silent on the first.
    const guard = quietGuard({
      onSlow: () => {
        log(`command ${effective}: nothing answered in ${QUIET_MS / 1000}s`);
        void send(chatId, t(lang, 'bridge.cmd.slow', { cmd: effective, sec: QUIET_MS / 1000 }), threadId).catch(() => {});
      },
    });
    const handled = await handleControl({
      command: effective,
      lang,
      arg: effectiveArg,
      text,
      chatId,
      threadId,
      key,
      state,
      config,
      activeTurns,
      saveState,
      saveConfig,
      log,
      send: guard.wrap(send),
      // What `/jobs` shows: the turns holding a slot, and the keys without an
      // active turn waiting behind them.
      jobs: () => ({
        active: [...activeTurns.keys()].map((topic) => ({ key: topic, startedAt: turnStartedAt.get(topic) || 0 })),
        queued: [...queues.keys()].filter((topic) => !activeTurns.has(topic)).length,
        max: maxParallel(),
      }),
      api: tg,
      sendFile: (p, caption = '') => sendFile(chatId, threadId, p, caption),
      seedTopic: ensureTopicSeed,
      profile: profileOf(key),
      prices: (filter) => {
        const route = modelOf(profileOf(key));
        // One source, always the same one: OpenRouter's public list. The card
        // says in words that the number is a reference for the model, not the
        // bill of the route this install runs on.
        return renderPrices(filter, {
          model: route.model,
          provider: route.provider,
          lang,
        });
      },
      reply: guard.wrap((out, extra = {}) => sendWithMarkup(chatId, threadId, out, extra)),
      // `killTurn` already knows a stop that was asked from a crash.
      stopTurn: (k) => killTurn(k),
    });
    if (handled) return;
    // Not a command: the turn has its own progress panel and its own watchdog.
    guard.cancel();
  }

  // Remember this prompt so the «Повторить» button after a failure has
  // something to resend. Bounded: only the latest prompt per topic matters.
  lastPrompt.set(key, msg);

  // Project directory bound to this topic (set with /cd); config.cwd otherwise.
  // A bound directory that has been deleted or renamed is reported as such: the
  // old silent fallback to config.cwd ran the turn in a different project than
  // the one the person bound, and every path in the answer was wrong.
  const boundDir = (state.cwd && state.cwd[key]) || '';
  if (boundDir && !existsSync(boundDir)) {
    log(`turn refused for ${where}: bound directory gone (${boundDir})`);
    await send(chatId, t(lang, 'bridge.turn.noDir', { path: boundDir }), threadId);
    return;
  }
  const cwd = boundDir || config.cwd;

  // The load guard: one more Electron child on a machine at 95 % CPU is the
  // difference between a slow window and a frozen one for whoever else is using
  // this computer. Checked before the first process, when nothing is spent yet;
  // the prompt is held, not refused — see `load-guard.mjs`.
  if (await holdIfLoaded({ t, lang, key, where, cwd, chatId, threadId, msg, album, sendWithMarkup, log, guard: guardOf(config.loadGuard) })) return;

  // What the person actually wrote, before any injected block: the progress
  // message echoes it back so the first thing they see names their task, not a
  // generic spinner.
  const request = text;

  // The typing indicator and the turn clock start here, after the guard: a
  // "bot is typing" bubble over a turn that is not running is a lie.
  const stop = { done: false };
  const typing = typingLoop(chatId, threadId, stop);
  const started = Date.now();
  // Capture the session BEFORE the turn starts. A second message for the same
  // topic can overwrite `state.sessions[key]` while this turn is still running
  // (two messages a few seconds apart, or a copy-paste), and the late writer
  // then attached a fresh session id to a conversation that already had one.
  const sessionAtStart = state.sessions[key];
  // Remember the topic a turn is running in: it is where a release notice goes,
  // since a notice is about the install and the install serves every topic.
  if (state.lastKey !== key) {
    state.lastKey = key;
    saveState();
  }

  // Desktop-style goal: the topic's goal and task list travel with every turn,
  // so a fresh session after /new still knows what the project is aiming at.
  // Without a goal the turn still gets the one line that says how to start one:
  // a plan nobody can see is not a plan, and the agent cannot ask a question it
  // does not know exists.
  const topicGoal = goalOf(state, key);
  if (topicGoal) text = `${renderPromptBlock(topicGoal, key, GOAL_CMD)}\n\n---\n\n${text}`;
  else text = `${t(lang, 'prompt.taskHint', { goal: GOAL_CMD, key })}\n\n---\n\n${text}`;

  // Working notes: the agent writes a 💭 line at each decision point with
  // `say.mjs --thought`, and the progress message shows the last two. Off means
  // no instruction at all, so nothing is written and nothing is displayed.
  //
  // Each turn gets a file of its own, named `<chat>_<thread>_<turn>.jsonl`, and
  // its path travels with the turn: two topics working at once used to share
  // one note file, so each saw the other's lines and `say.mjs` had to guess
  // which topic a note belonged to. The bridge keeps a stable alias for the
  // topic (what older tools and the panel read) pointing at this turn's file.
  const turnId = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const thoughtFile = join(THOUGHT_DIR, `${chatId}_${threadId || 0}_${turnId}.jsonl`);
  // The alias is the plain topic name too; it is written as the turn's file so
  // a reader that never heard of DSH_TG_THOUGHT still finds this turn's notes.
  const thoughtEnv = { DSH_TG_THOUGHT: thoughtFile };
  // In `chat` mode every 💭 line is also posted as its own message, so the
  // prompt has to say that out loud: a line written for a small grey card reads
  // differently when it lands in the chat as a message of its own.
  const notesMode = reasoningMode(state, config, key);
  if (notesMode !== 'off') {
    const prompt = t(lang, 'prompt.reasoning', { say: join(DIR, 'say.mjs') });
    const note = notesMode === 'chat' ? `\n\n${t(lang, 'prompt.reasoningChat')}` : '';
    text = `${prompt}${note}\n\n---\n\n${text}`;
  }

  // Live progress: one status message per turn, rewritten as the agent works.
  // Without it a long turn and a hung turn looked exactly alike in the chat.
  const progress = await startProgress(chatId, threadId, lang, request, settingsChipOf(key, turnProfile), thoughtFile);
  // Turn telemetry for the log, and the per-event handler that fills it. Both
  // live in `turn-events.mjs`: this file is at its ceiling and the event
  // vocabulary is not its subject.
  const telemetry = newTelemetry(modelOf(profileOf(key)).model);
  /** Failed tool results, kept only until the turn ends: see `sandbox-note.mjs`. */
  const refusals = [];
  const onEvent = makeTurnEvents({
    progress,
    telemetry,
    refusals,
    log,
    onSession: (id) => liveSessions.set(key, id),
  });
  const attempt = turnAttempt(text, key, { onEvent, onAbort: () => killTurn(key), env: thoughtEnv, profile: turnProfile || profileOf(key), cwd, lang });
  let result = await attempt(sessionAtStart);
  if (result.error && /unknown id|not found|не найдена|was recorded in/i.test(result.error) && sessionAtStart) {
    delete state.sessions[key];
    log(`session dropped for ${where}: recorded in another directory, starting fresh`);
    result = await attempt('');
  }
  // Provider failover: the headless profile has no failover plugin, so one busy
  // route ("all providers are busy", 503, or a turn that emits nothing at all)
  // used to end as silence. Retry the SAME prompt on the next model in the
  // chain before giving up — the person cares about an answer, not the vendor.
  // The walk lives in `fallback.mjs`: a chain that mixes companies needs a probe
  // per provider, and this file is at its size ceiling.
  result = await runFallbackChain({
    result,
    chain: Array.isArray(config.fallbackModels) ? config.fallbackModels : [],
    // The route this topic actually runs on, so a final verdict names the right
    // host instead of a hardcoded one.
    primary: modelOf(turnProfile || profileOf(key) || config.profile),
    text,
    sessionAtStart,
    key,
    where,
    chatId,
    threadId,
    lang,
    cwd,
    turnProfile,
    topicProfile: profileOf(key),
    telemetry,
    onEvent,
    thoughtEnv,
    send,
  });
  // A session opened in the desktop UI holds its write handle, so the CLI
  // refuses to adopt it. Retry once, then continue in a fresh session instead
  // of failing the user's message.
  if (result.error && /already owned by an active write handle/i.test(result.error)) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    result = await attempt(state.sessions[key] ?? sessionAtStart);
    if (result.error && /already owned by an active write handle/i.test(result.error)) {
      delete state.sessions[key];
      saveState();
      result = await attempt('');
      if (!result.error) result.text = `${t(lang, 'bridge.fallback.sessionBusy')}\n\n${result.text}`;
    }
  }
  stop.done = true;
  await typing;
  // Name the cause once, in a short stable code, so a screenshot of the error is
  // enough to find the fix — and every code has a concrete next step, not "try again".
  if (result.error) result.error = explainFailure(result.error, lang);
  await progress.finish(result);

  // Never move a topic onto a different session once it has one. A retry that
  // fell back to a fresh session (busy write handle, stale id) is reported in
  // the reply, but persisting it would silently fork the conversation and drop
  // the project context the next message depends on.
  if (result.sessionId && !result.error) {
    if (!sessionAtStart) {
      state.sessions[key] = result.sessionId;
      saveState();
    } else if (result.sessionId !== sessionAtStart) {
      log(`kept session ${sessionAtStart} for ${where} (turn ran in ${result.sessionId})`);
      state.sessions[key] = sessionAtStart;
      saveState();
    }
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  const cachePct = telemetry.cacheReadTokens
    ? Math.round((telemetry.cacheReadTokens / Math.max(1, telemetry.cacheReadTokens + telemetry.inputTokens)) * 100)
    : 0;
  const summary = `tools=${telemetry.tools} tokens=${telemetry.inputTokens} cache=${cachePct}% model=${telemetry.model} cwd=${cwd}`;
  if (result.stopped) {
    // Stopped on purpose: no answer, but nothing broke either. It gets its own
    // log word so "why did the turn end" is answerable without guessing, and it
    // deliberately does NOT overwrite `state.lastFailure` — `/report` after a
    // stop should describe the last real failure, not the stop itself.
    log(`turn stopped ${where} ${seconds}s ${summary}`);
    return;
  }
  if (result.error) {
    // The card carries the failure; the log gets the detail. `noteTurn` decides
    // whether a code fault means the version on disk cannot be trusted.
    log(`turn failed ${where} ${seconds}s ${summary} :: ${result.error.slice(0, 400)}`);
    await noteTurn(state, {
      key, error: result.error, model: telemetry.model, tools: telemetry.toolNames, cwd, seconds,
      lang, chatId, threadId, log, t, send,
    });
    saveState();
    return;
  }
  log(`turn ok ${where} ${seconds}s session=${result.sessionId} ${summary}`);
  // Who answered, for `/model` and the settings card: the card configures the
  // topic's route, and after a fallback that route is not the one that replied.
  noteAnswered(state, key, telemetry);
  // An answered turn proves this release works, and makes it the version a later
  // rollback returns to.
  await noteTurn(state, { saveState });
  // A turn that ends without an answer hands back its last assistant text —
  // the reasoning — and sending that looks exactly like the bot answering with
  // its own notes. Say what happened instead of forwarding the page.
  if (looksLikeReasoning(result.text, progress.reasoning())) {
    log(`reasoning echo suppressed for ${where} (${String(result.text).length} chars)`);
    await send(chatId, t(lang, 'bridge.progress.reasoningOnly'), threadId);
    return;
  }
  await send(chatId, result.text || t(lang, 'bridge.progress.emptyReply'), threadId);
  // A refusal explains the turn that just ended, so it goes after the answer.
  await reportRefusals({
    refusals,
    lang,
    log,
    where,
    send: (body, keyboard) => sendWithMarkup(chatId, threadId, body, { reply_markup: keyboard }),
  });
}
