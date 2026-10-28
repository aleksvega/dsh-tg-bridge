// dsh-telegram-bridge — Telegram <-> DSH without any UI.
//
// Long-polls the Telegram Bot API and runs every message through
// `dsh --profile headless --json`, resuming one persisted DSH session per chat
// (and per forum topic inside a supergroup). No browser, no SPA panel, no
// dsh-im: the only moving parts are this process and the DSH CLI. Start it with
// the logon task (see README.md).
import { spawn } from 'node:child_process';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, unlinkSync,
  readdirSync, statSync, openSync, fsyncSync, closeSync, renameSync, writeFileSync as writeFd,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, basename, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Force IPv4 for every fetch. DNS returns an AAAA next to the A record, and
// Happy Eyeballs happily picks the IPv6 path, which here costs ~5 s or dies
// outright ("fetch failed" every 6 s, measured 22.10.2026: IPv4 0.34 s, IPv6
// 5.3 s, IPv6 to GitHub 0.02 s refused). The --dns-result-order flag alone
// does not bind fetch/undici, so pin the family on the socket layer.
import dns from 'node:dns';
import net from 'node:net';
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(false);
import { noticeIsObsolete } from './queue-notice.mjs';
import { immediateKind } from './immediate.mjs';
import { writeSteerJob } from './steer-queue.mjs';
import { allowedSender } from './allowlist.mjs';
import { inlineText } from './media-text.mjs';
import { createAlbumBuffer } from './albums.mjs';
import { turnArgs } from './cli-args.mjs';
import { chunk, markdownParts, toPlainText, toTelegramHtml } from './format.mjs';
import { mediaPrompt, readVoiceIntoText } from './media.mjs';
import { busyNotices, clearBusyNotice, steerAvailable, steerMediaMessage, steerRunningTurn } from './steer.mjs';
import { MAX_PARALLEL, approvals, bufferAlbum, enqueue, lastPrompt, queues, rewindUsed, setMessageHandler } from './queue.mjs';
import { ensureProfile } from './profiles.mjs';
import { firstLiveModel, describeVerdicts, probeHint, probeModel } from './model-probe.mjs';
import { explainFailure } from './failures.mjs';
import { handleControl, CONTROL_COMMANDS, modelOf, modelsOf, reasoningOf } from './control.mjs';
import { bridgeVersion, installRelease, npmLatestAsync } from './control.mjs';
import { dueForCheck, updateState } from './update-policy.mjs';
import { drainGoalJobs, goalOf, progressOf, renderPromptBlock, toggleTask } from './goals.mjs';
import { renderPrices } from './prices.mjs';
import { t, resolveLang } from './i18n.mjs';
import { progressPanel, stepLine, addStep } from './panel.mjs';
import { AgentsetStore } from './agentsets.mjs';
import { profileValues, resolveSettings, settingsChip } from './settings.mjs';
import { parseAgentPresets, parsePermissionPresets, parseReasoningEfforts } from './agents.mjs';
import { drainAsetJobs } from './aset-jobs.mjs';
import { materialiseProfile, pruneDerived } from './aset-profile.mjs';
import { parseCallback } from './aset-schema.mjs';
import { commandFor, renderSettingsCard, settingsCurrent } from './settings-card.mjs';
import { answerRewindPress, cutSession, isRewindPress } from './rewind-buttons.mjs';
import { applyRewind, newestBackup, restoreBackup } from './rewind.mjs';
import { sessionFile } from './thoughts.mjs';
import { MENU_PREFIX, commandForName, isMenuPress, keyboardCommand, menuTarget, renderPanel, runsUnasked } from './menu-card.mjs';
import {
  APP, CLI_JS, CRED, DIR, DONE_FILE, DONE_TTL_MS, DSH_HOME, EXE, GOAL_CMD, HOME, LOG,
  PENDING_DIR, PID_FILE, RESTART_MARKER, RESTART_NOTICE, SAY, SELF_DIR, STATE, STEER_DIR,
  THOUGHT_DIR,
} from './paths.mjs';
import {
  ack, config, done, log, pendingPath, pendingUpdates, saveDone, saveState, state, writeAtomic, writePending,
} from './state.mjs';
import { findToken, providerKeys, readSecret, token } from './secrets.mjs';
import { GENERAL_SAFE, commandOf, immediateCommandOf, langFor, lastTurnTarget, setBotUsername } from './commands.mjs';
import { sessionKey, threadOf } from './keys.mjs';
import { speedOf, startProgress } from './progress.mjs';
import { activeTurns, killTurn, liveSessions, profileOf, runTurn, runTurnLive, turnStartedAt, typingLoop } from './turn.mjs';
import { approvalKeyboard, continueKeyboard, errorKeyboard } from './keyboards.mjs';
import { ensureTopicSeed, logTopicToGeneral, newestBoundTopic, noteSeed, topicName, topicSeeded, topicSeededRecently, touchTopic } from './topics.mjs';
import { downloadFile, send, sendEphemeral, sendFile, sendWithMarkup, tg } from './telegram.mjs';

setMessageHandler(handleMessage);

/**
 * Run a command the same way a typed one runs, for a button that stands for it.
 * The callback handlers below need this: a press must reach `handleControl` with
 * exactly the context a typed command gets.
 */
async function runCommandFromButton(typed, { chatId, threadId, key }) {
  const lang = langFor(chatId, threadId);
  const [head, ...rest] = typed.trim().split(/\s+/);
  const arg = rest.join(' ');
  const handled = await handleControl({
    command: head,
    arg,
    text: typed,
    lang,
    chatId,
    threadId,
    key,
    state,
    config,
    activeTurns,
    saveState,
    log,
    send,
    jobs: () => ({
      active: [...activeTurns.keys()].map((topic) => ({ key: topic, startedAt: turnStartedAt.get(topic) || 0 })),
      queued: [...queues.keys()].filter((topic) => !activeTurns.has(topic)).length,
      max: MAX_PARALLEL,
    }),
    api: tg,
    sendFile: (p, caption = '') => sendFile(chatId, threadId, p, caption),
    // A report meant to be read once (/thoughts) can ask for a message that
    // removes itself. Without this the chat is told it will disappear while the
    // message is a normal one — a promise nothing was keeping.
    ephemeral: (out) => sendEphemeral(chatId, out, threadId),
    seedTopic: ensureTopicSeed,
    profile: profileOf(key),
    reply: (out, extra = {}) => sendWithMarkup(chatId, threadId, out, extra),
    stopTurn: (k) => {
      const child = activeTurns.get(k);
      if (!child) return false;
      try {
        child.kill();
        activeTurns.delete(k);
        return true;
      } catch {
        return false;
      }
    },
  });
  if (!handled) await send(chatId, t(lang, 'bridge.cb.unknown'), threadId);
}

mkdirSync(DIR, { recursive: true });
try {
  const other = Number(readFileSync(PID_FILE, 'utf8').trim());
  if (Number.isInteger(other) && other > 0 && other !== process.pid) {
    try {
      process.kill(other, 0);
      process.exit(0);
    } catch {}
  }
} catch {}
writeFileSync(PID_FILE, String(process.pid), 'utf8');
/**
 * Silent deaths are undebuggable.
 *
 * A bridge launched by Task Scheduler has no console, so an uncaught error used
 * to kill the poller with nothing in bridge.log but "bridge started" — from the
 * outside the bot simply stopped answering. Every fatal path now leaves a line
 * with the stack in bridge.log, and the exit hook records the code so a kill by
 * Task Scheduler (0xC000013A) is distinguishable from a Node crash (1).
 */
process.on('uncaughtException', (error) => {
  log(`FATAL uncaught: ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log(`FATAL unhandled rejection: ${reason && reason.stack ? reason.stack : reason}`);
});
process.on('exit', (code) => {
  log(`bridge exiting code=${code}`);
  try {
    if (readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) unlinkSync(PID_FILE);
  } catch {}
});



/**
 * One line for the progress head saying which settings this topic overrides.
 * Empty for every install that never binds a set: the panel stays as it was.
 * An unreadable agentsets.json must not cost the turn its panel, so this never
 * throws.
 */
function settingsChipOf(key) {
  try {
    const id = state.agentsets?.[key];
    if (!id) return '';
    const store = new AgentsetStore(join(DIR, 'agentsets.json')).load();
    const set = store.get(id);
    if (!set) return '';
    const profile = profileOf(key);
    const patch = readFileSync(join(DSH_HOME, 'profiles', profile, 'cordis.patch.yml'), 'utf8');
    const resolved = resolveSettings({
      set,
      override: state.settings?.[key] || null,
      profile: profileValues(profileRowOf(profile, patch)),
      models: modelsOf(profile),
      efforts: parseReasoningEfforts(patch, set.model || modelOf(profile).model) || [],
      permissions: parsePermissionPresets(patch)?.presets?.map((p) => p.id) || [],
      presets: parseAgentPresets(patch)?.presets?.map((p) => p.id) || [],
    });
    return settingsChip(resolved, { name: set.name || set.id });
  } catch {
    return '';
  }
}

/** What the profile itself says, as `resolveSettings` wants it. */
function profileRowOf(profile, patch = '') {
  const text = patch || readFileSync(join(DSH_HOME, 'profiles', profile, 'cordis.patch.yml'), 'utf8');
  const model = modelOf(profile);
  const named = parsePermissionPresets(text);
  return profileValues({
    model,
    // The preset the table actually starts in, not just the first row: a
    // profile whose default is read-only must not read as workspace-write.
    permissions: /defaultPreset:\s*(\S+)/.exec(text)?.[1] || named?.presets?.find((p) => p.sandbox)?.id || '',
    preset: parseAgentPresets(text)?.selected || '',
    effort: '',
  });
}

/**
 * The profile a turn actually runs under. A bound set becomes a profile of its
 * own (`aset-profile.mjs`), because DSH has no per-topic override; without a set
 * the answer is the topic's or the install's profile, unchanged.
 * `keep` tells the sweep every profile still in use.
 */
function turnProfileOf(key) {
  const base = profileOf(key);
  try {
    const id = state.agentsets?.[key];
    if (!id) return base;
    const store = new AgentsetStore(join(DIR, 'agentsets.json')).load();
    const set = store.get(id);
    if (!set) return base;
    const derived = materialiseProfile(set, base);
    if (!derived) return base;
    const keep = Object.keys(state.agentsets || {})
      .map((topic) => {
        const bound = state.agentsets[topic];
        const other = store.get(bound);
        return other ? materialiseProfile(other, profileOf(topic)) : '';
      })
      .filter(Boolean);
    pruneDerived(keep);
    return derived;
  } catch (error) {
    // A broken store must not cost the turn: the profile runs as it would have.
    log(`aset profile failed for ${key}: ${error.message}`);
    return base;
  }
}

/**
 * Bind, unbind or edit a set for one topic — the single implementation behind
 * `/agentset`, the card's buttons and the job a running turn drops.
 */
function applyAsetJob(job) {
  const { chatId, threadId = 0, action = 'use', id = '', field = '', value } = job || {};
  if (!chatId) return { ok: false, text: 'no chat' };
  const key = sessionKey(String(chatId), Number(threadId) || 0);
  const store = new AgentsetStore(join(DIR, 'agentsets.json')).load();
  if (!state.agentsets) state.agentsets = {};
  if (action === 'off') {
    if (!state.agentsets[key]) return { ok: true, changed: false, text: 'no set bound' };
    delete state.agentsets[key];
    if (state.settings) delete state.settings[key];
    return { ok: true, changed: true, text: 'set off' };
  }
  const set = store.get(id);
  if (!set) return { ok: false, text: `no set ${id}` };
  if (action === 'use') {
    state.agentsets[key] = id;
    return { ok: true, changed: true, text: `bound ${id}`, setId: id };
  }
  if (action === 'edit') return { ok: false, text: 'edit goes through /agentset' };
  return { ok: false, text: `unknown action ${action}` };
}

/**

/**
 * A task list as one message plus one button per task. The label carries the
 * state, the payload carries only the number, so the card survives a relabel and
 * stays inside Telegram's 64-byte callback limit.
 */
function renderTaskCard(goal, lang) {
  const { done, total } = progressOf(goal);
  const lines = [t(lang, 'goal.set', { text: goal.text })];
  goal.tasks.forEach((task, i) => lines.push(`${task.done ? '✅' : '⬜'} ${i + 1}. ${task.text}`));
  lines.push(t(lang, 'goal.progress', { done, total }), '', t(lang, 'task.tapHint'));
  return lines.join('\n');
}

function taskRows(goal) {
  if (!goal || goal.done) return [];
  const rows = [];
  for (let i = 0; i < Math.min(goal.tasks.length, 90); i += 3) {
    rows.push(goal.tasks.slice(i, i + 3).map((task, k) => ({ text: `${task.done ? '✅' : '⬜'} ${i + k + 1}`, data: `t:${i + k + 1}` })));
  }
  return rows;
}

// The agent updates the topic goal list by dropping a job file (goal.mjs);
// the bridge is the only writer of state.json, so there is no lock race.
const GOAL_DIR = join(DIR, 'goal-jobs');
setInterval(() => {
  try {
    if (drainGoalJobs(state, GOAL_DIR, join(GOAL_DIR, 'done'))) saveState();
  } catch (error) {
    log(`goal job failed: ${error.message}`);
  }
}, 2000).unref();

// `/agentset` dropped as a job by a running turn (aset-jobs.mjs). The apply
// function is the same one that answers `/agentset` in the chat, so a job and a
// typed command cannot drift apart.
const ASET_DIR = join(DIR, 'aset-jobs');
setInterval(() => {
  try {
    const results = drainAsetJobs(DIR, (job) => applyAsetJob(job));
    for (const result of results) {
      log(`aset job ${result.job?.setId || result.job?.id || '?'} -> ${result.ok ? 'ok' : 'refused'}`);
      if (result.changed) saveState();
      if (result.job?.chatId) {
        Promise.resolve(send(String(result.job.chatId), result.text, Number(result.job.threadId) || 0))
          .catch((error) => log(`aset job answer failed: ${error.message}`));
      }
    }
  } catch (error) {
    log(`aset job failed: ${error.message}`);
  }
}, 2000).unref();

// Reminders: a turn is one short-lived process, so the only clock that can
// outlive a message is this one. A reminder that came due while the bridge was
// down fires on the first tick after it starts; one created for a topic that
// has since been deleted still tries, and the delivery error is logged.
setInterval(() => {
  try {
    const now = Date.now();
    const rows = Array.isArray(state.reminders) ? state.reminders : [];
    const ready = rows.filter((row) => row && Number(row.at) <= now);
    if (ready.length === 0) return;
    const ids = new Set(ready.map((row) => row.id));
    state.reminders = rows.filter((row) => !ids.has(row.id));
    saveState();
    for (const row of ready) {
      Promise.resolve(send(String(row.chatId), t(row.lang || config.lang || 'en', 'ctrl.remind.due', { text: row.text }), Number(row.threadId) || 0))
        .then(() => log(`reminder ${row.id} delivered`))
        .catch((error) => log(`reminder ${row.id} delivery failed: ${error.message}`));
    }
  } catch (error) {
    log(`reminder loop failed: ${error.message}`);
  }
}, 20_000).unref();

if (!token) {
  log('FATAL: bot token not found — run `node cli.mjs init --token <t> --user <id>` or set DSH_TELEGRAM_BOT_TOKEN');
  process.exit(1);
}




async function handleMessage(msg, album = null) {
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

  // 4. Lobby rule (Hermes' topic mode): the General thread is where topics are
  //    started, not where work runs. A message with no thread id goes to the
  //    most recently active topic instead of forking a root session — that is
  //    exactly how a prompt typed in General used to be answered in General
  //    while its topic stayed empty.
  if (threadId === 0 && config.generalLobby !== false) {
    const recovered = newestBoundTopic(chatId);
    if (recovered > 0) {
      log(`General message recovered into topic ${recovered}`);
      threadId = recovered;
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
  if (!turnProfile) turnProfile = turnProfileOf(key);

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
      log,
      send,
      // What `/jobs` shows: the turns that hold a slot right now and how many
      // wait behind them. `queues` counts a topic that is running too, so the
      // waiters are the keys without an active turn.
      jobs: () => ({
        active: [...activeTurns.keys()].map((topic) => ({ key: topic, startedAt: turnStartedAt.get(topic) || 0 })),
        queued: [...queues.keys()].filter((topic) => !activeTurns.has(topic)).length,
        max: MAX_PARALLEL,
      }),
      api: tg,
      sendFile: (p, caption = '') => sendFile(chatId, threadId, p, caption),
      seedTopic: ensureTopicSeed,
      profile: profileOf(key),
      prices: (filter) => {
        const route = modelOf(profileOf(key));
        // A provider page is optional: without `pricesUrl` the answer comes from
        // the public models.dev catalog, so no install is tied to one vendor.
        return renderPrices(filter, {
          model: route.model,
          provider: route.provider,
          pageUrl: config.pricesUrl || '',
          lang,
        });
      },
      reply: (out, extra = {}) => sendWithMarkup(chatId, threadId, out, extra),
      stopTurn: (k) => {
        const child = activeTurns.get(k);
        if (!child) return false;
        try {
          child.kill();
          activeTurns.delete(k);
          return true;
        } catch {
          return false;
        }
      },
    });
    if (handled) return;
  }

  // Remember this prompt so the «Повторить» button after a failure has
  // something to resend. Bounded: only the latest prompt per topic matters.
  lastPrompt.set(key, msg);

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
  // Project directory bound to this topic (set with /cd); config.cwd otherwise.
  const cwd = (state.cwd && state.cwd[key]) || config.cwd;
  // What the person actually wrote, before any injected block: the progress
  // message echoes it back so the first thing they see names their task, not a
  // generic spinner.
  const request = text;

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
  if (reasoningOf(state, config, key)) {
    text = `${t(lang, 'prompt.reasoning', { say: join(DIR, 'say.mjs') })}\n\n---\n\n${text}`;
  }

  // Live progress: one status message per turn, rewritten as the agent works.
  // Without it a long turn and a hung turn looked exactly alike in the chat.
  const progress = await startProgress(chatId, threadId, lang, request, settingsChipOf(key), thoughtFile);
  // Turn telemetry for the log: what the agent did, how much it cost, on which
  // model. Without it /logs shows only "in" and "sent" — useless when asking
  // "why did this take 9 minutes".
  const telemetry = { steps: 0, tools: 0, inputTokens: 0, cacheReadTokens: 0, model: modelOf(profileOf(key)).model };
  const onEvent = (event) => {
    try {
      // The id of the session this process actually works in. A new topic has
      // no id until the CLI emits one, and steering needs it before that.
      if (event.type === 'session' && event.sessionId) liveSessions.set(key, event.sessionId);
      progress.handle(event);
      if (event.type === 'tool_call') {
        telemetry.tools += 1;
        telemetry.steps += 1;
        log(`  tool[${telemetry.steps}] ${(stepLine(event) || event.tool || 'tool').slice(0, 140)}`);
      } else if (event.type === 'tool_result') {
        const failed = event.status && event.status !== 'completed';
        log(`  tool[${telemetry.steps}] ${failed ? 'ERROR' : 'ok'} ${String(event.tool || '').slice(0, 40)}`);
      } else if (event.type === 'status' && event.usage) {
        if (Number.isFinite(event.usage.inputTokens)) telemetry.inputTokens = event.usage.inputTokens;
        if (Number.isFinite(event.usage.cacheReadTokens)) telemetry.cacheReadTokens = event.usage.cacheReadTokens;
      }
    } catch {}
  };
  let result = await runTurnLive(text, sessionAtStart, key, { onEvent, onAbort: () => killTurn(key), onHeartbeat: () => progress.heartbeat(), env: thoughtEnv, extraArgs, cwd, lang, profile: turnProfile });
  if (result.error && /unknown id|not found|не найдена|was recorded in/i.test(result.error) && sessionAtStart) {
    delete state.sessions[key];
    log(`session dropped for ${where}: recorded in another directory, starting fresh`);
    result = await runTurnLive(text, '', key, { onEvent, onAbort: () => killTurn(key), onHeartbeat: () => progress.heartbeat(), env: thoughtEnv, extraArgs, cwd, lang, profile: turnProfile });
  }
  // Provider failover: the headless profile has no failover plugin, so one busy
  // route ("all providers are busy", 503, or a turn that emits nothing at all)
  // used to end as silence. Retry the SAME prompt on the next model in the
  // chain before giving up — the person cares about an answer, not the vendor.
  const chain = Array.isArray(config.fallbackModels) ? config.fallbackModels : [];
  // A dead paid balance is not a "busy provider": it must trigger the free
  // chain as well, otherwise the bridge sits on AUTH 403 and gives up.
  const FALLBACK_TRIGGERS = /RATE_LIMIT|503|all providers|нет активности|EMPTY_RESPONSE|TIMEOUT|overloaded|AUTH|403|insufficient_user_quota|quota|UNKNOWN_MODEL|MISSING_CREDENTIAL/i;
  const QUOTA_LIKE = /insufficient_user_quota|AUTH\b|\b403\b|\b401\b|quota|balance|баланс|payment|billing/i;
  // "get_channel_failed / all providers are busy" is the provider's own channel
  // pool, not the model: when it is down, it is down for every model in the
  // chain. One probe then answers in seconds what four full turns spent 741
  // seconds discovering.
  const CHANNEL_DOWN = /get_channel_failed|all providers|no providers|503/i;
  const tried = [];
  for (const entry of chain) {
    if (!result.error || !FALLBACK_TRIGGERS.test(result.error)) break;
    if (!entry.patch || !existsSync(entry.patch)) continue;
    // The provider's channel pool is down: every model in the chain will answer
    // the same 503. Ask once, quickly, and say so instead of burning a turn per
    // model. A probe that DOES answer proves the pool is back — then the chain
    // goes on, and the fallback at hand is tried as usual.
    if (tried.length >= 1 && CHANNEL_DOWN.test(result.error)) {
      const verdict = await probeModel(config.primaryModel || 'deepseek-v4.1-flash-1017');
      log(`channel down after ${tried.length} model(s): probe says ${verdict.kind}; not trying ${entry.model}`);
      if (!verdict.ok) break;
    }
    const quotaLike = QUOTA_LIKE.test(result.error);
    // Quota failures never deserve a retry of the same model: the balance is
    // gone, so waiting is pure loss. Anything else gets one retry at most.
    const reason = quotaLike ? t(lang, 'bridge.fallback.quota') : t(lang, 'bridge.fallback.noAnswer');
    tried.push(`${entry.model}: ${String(result.error).slice(0, 120)}`);
    log(`fallback to ${entry.model} for ${where} reason=${quotaLike ? 'quota' : 'transient'} after: ${String(result.error).slice(0, 120)}`);
    telemetry.model = entry.model;
    await send(chatId, t(lang, 'bridge.fallback.switched', {
      reason,
      model: entry.model,
      free: entry.free ? ' (free)' : '',
    }), threadId);
    result = await runTurnLive(text, sessionAtStart, key, {
      onEvent,
      onAbort: () => killTurn(key),
      onHeartbeat: () => progress.heartbeat(), env: thoughtEnv,
      // Same overlay problem as the vision turn: the host CLI has no --patch.
      // A patch file that is missing or unreadable must not turn into an empty
      // --profile argument, so the topic's own profile is the fallback.
      profile: ensureProfile(entry.patch) || profileOf(key) || config.profile,
      cwd,
      lang,
    });
    if (!result.error) break;
  }
  // Every model refused. Before saying "all models are unavailable", ask each
  // channel directly with a 1-token request: a 503 storm usually clears within
  // seconds, and the verdict tells the person whether the balance is gone or the
  // provider is merely busy — the old message always claimed quota.
  let probeKind = '';
  if (result.error && FALLBACK_TRIGGERS.test(result.error)) {
    const models = [config.primaryModel || 'deepseek-v4.1-flash-1017', ...chain.map((entry) => entry.model)];
    const { live, verdicts } = await firstLiveModel(models);
    if (live) {
      log(`probe: ${live.model} answers after ${verdicts.length} check(s), retrying the turn there`);
      const entry = chain.find((item) => item.model === live.model);
      result = await runTurnLive(text, sessionAtStart, key, {
        onEvent,
        onAbort: () => killTurn(key),
        onHeartbeat: () => progress.heartbeat(),
        profile: entry ? ensureProfile(entry.patch) : turnProfile,
        cwd,
        lang,
      });
    } else {
      // Nothing answers: the verdict is the only useful part of the failure.
      probeKind = describeVerdicts(verdicts);
      log(`probe: no channel answers (${verdicts.map((v) => `${v.model}:${v.kind}`).join(', ')})`);
    }
  }
  // Every model refused — or the provider's own channel pool was down and the
// chain stopped early, which is the same answer to the person: one message
// naming the causes, not a cascade of errors.
  if (result.error && tried.length > 0 && (probeKind || tried.length >= (Array.isArray(config.fallbackModels) ? config.fallbackModels.length : 0))) {
    log(`all fallbacks exhausted for ${where}: ${tried.length} probe=${probeKind || 'n/a'}`);
    const verdictLine = probeKind ? `\n${probeHint(probeKind, lang)}` : '';
    result = {
      sessionId: result.sessionId,
      text: '',
      error: t(lang, 'bridge.fallback.allDown', { list: tried.map((line) => `• ${line}`).join('\n') }) + verdictLine,
    };
  }
  // A session opened in the desktop UI holds its write handle, so the CLI
  // refuses to adopt it. Retry once, then continue in a fresh session instead
  // of failing the user's message.
  if (result.error && /already owned by an active write handle/i.test(result.error)) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    result = await runTurnLive(text, state.sessions[key] ?? sessionAtStart, key, { onEvent, onAbort: () => killTurn(key), onHeartbeat: () => progress.heartbeat(), env: thoughtEnv, extraArgs, cwd, lang, profile: turnProfile });
    if (result.error && /already owned by an active write handle/i.test(result.error)) {
      delete state.sessions[key];
      saveState();
      result = await runTurnLive(text, '', key, { onEvent, onAbort: () => killTurn(key), onHeartbeat: () => progress.heartbeat(), env: thoughtEnv, extraArgs, cwd, lang, profile: turnProfile });
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
  if (result.error) {
    // The status message already carries the failure (progress.finish turned it
    // into the error report), so only the log gets the detail here — a second
    // ⚠️ message would just duplicate it.
    log(`turn failed ${where} ${seconds}s ${summary} :: ${result.error.slice(0, 400)}`);
    return;
  }
  log(`turn ok ${where} ${seconds}s session=${result.sessionId} ${summary}`);
  await send(chatId, result.text || t(lang, 'bridge.progress.emptyReply'), threadId);
}

// `probeHint` lives in model-probe.mjs: this file used it at the call site and
// defined it below, and the hint never reached the person.



/** Answer a button press: acknowledge, act, and describe the outcome. */
async function handleCallback(query) {
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
        reply_markup: { inline_keyboard: card.keyboard },
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
      reply_markup: { inline_keyboard: taskRows(goal) },
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

/**
 * Answer a button from the settings card.
 *
 * Two kinds of press, one rule: the card is a view of the commands.
 *
 * - A tab (`m:agent`) redraws the same message as another page.
 * - A switch or a door (`m:reasoning:on`, `m:model`) runs the command a person
 *   would have typed, through `handleControl`, and then replaces the card with
 *   one plain line saying what changed. The card does not stay: a menu left in
 *   the history is what the person asked to avoid, and one line is easier to
 *   delete than a twelve-row keyboard.
 *
 * The press carries no text of its own, which is why `handleMessage` is not this
 * path's entry point: it would journal, queue and spend a turn on a tap.
 */
async function handleCardPress(query, ctx) {
  const { chatId, messageId, threadId, key, lang } = ctx;
  const data = String(query.data || '');
  const current = settingsCurrent({ config, state, key, reasoningOf });
  const updateMode = state.update?.mode || 'check';
  const wanted = commandFor({ t: (k, vars) => t(lang, k, vars), current, updateMode }, data);

  if (!wanted) {
    await tg('answerCallbackQuery', { callback_query_id: query.id, text: t(lang, 'settings.card.stale') }).catch(() => {});
    return;
  }

  if (wanted.page) {
    const card = renderSettingsCard({
      page: wanted.page,
      t: (k, vars) => t(lang, k, vars),
      current,
      updateMode,
      bound: boundSetOf(key),
    });
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: card.text,
      reply_markup: { inline_keyboard: card.keyboard },
      ...(threadId > 0 ? { message_thread_id: threadId } : {}),
    }).catch((error) => log(`settings card redraw failed: ${error.message}`));
    await tg('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});
    return;
  }

  // Run the command. Whatever it answers goes in the log and, by default, not
  // in the chat: the one line below is the chat's share of this press. Only a
  // command that failed says more than that.
  const replies = [];
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
    log,
    send: (text) => {
      replies.push(String(text ?? ''));
      return Promise.resolve(0);
    },
    reply: (text) => {
      replies.push(String(text ?? ''));
      return Promise.resolve(0);
    },
    jobs: () => ({ active: [], queued: 0, max: MAX_PARALLEL }),
    api: tg,
    sendFile: () => Promise.resolve(0),
    profile: profileOf(key),
    prices: () => Promise.resolve(''),
  }).catch((error) => {
    log(`settings press ${data} failed: ${error.message}`);
    replies.push(error.message);
    return true;
  });

  const changed = Boolean(wanted.value);
  const answerText = changed
    ? t(lang, 'settings.card.changed', { label: wanted.label, value: wanted.value })
    : t(lang, 'settings.card.door', { command: wanted.command });

  // The card becomes the line: the buttons go away with the text they described.
  await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: answerText,
    ...(threadId > 0 ? { message_thread_id: threadId } : {}),
  }).catch(() => {});
  await tg('answerCallbackQuery', { callback_query_id: query.id }).catch(() => {});

  // A door that opened to nothing (an unknown set id, a command that is not
  // allowed here) still has something to say; it goes under the line, once.
  if (!handled) log(`settings press ${data}: no handler answered`);
  const notLine = replies.filter(Boolean).filter((r) => r !== answerText);
  if (notLine.length > 0 && !changed) {
    await send(chatId, notLine[0], threadId).catch(() => {});
  }
}

/**
 * The set bound to this topic, for the card that names it. Read through the
 * agentset store the commands use, so the card never keeps a second copy.
 */
function boundSetOf(key) {
  const id = state.agentsets?.[key];
  if (!id) return null;
  try {
    return new AgentsetStore(join(DIR, 'agentsets.json')).load().get(id) || null;
  } catch {
    return null;
  }
}


async function main() {
  log('bridge started');
  // Downloaded photos live in the runtime directory and every album leaves a
  // few behind. A week is long enough for "look at that picture again" in a
  // session, short enough that the directory does not grow without a bound.
  try {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let pruned = 0;
    for (const name of readdirSync(DIR)) {
      if (!/^photo-\d+-\d+\.jpg$/.test(name)) continue;
      const path = join(DIR, name);
      if (statSync(path).mtimeMs < cutoff) {
        unlinkSync(path);
        pruned++;
      }
    }
    if (pruned) log(`pruned ${pruned} old photo(s)`);
  } catch (error) {
    log(`photo prune failed: ${error.message}`);
  }
  try {
    const me = await tg('getMe');
    setBotUsername(me.username || '');
    log(`bot @${me.username}`);
    // Confirm the restart in the topic it was asked from, not in the DM: the
    // person who typed `/restart confirm` was looking at that thread.
    try {
      if (existsSync(RESTART_NOTICE)) {
        const notice = JSON.parse(readFileSync(RESTART_NOTICE, 'utf8'));
        unlinkSync(RESTART_NOTICE);
        if (Date.now() - Number(notice.at || 0) < 10 * 60 * 1000) {
          const lang = resolveLang(state, sessionKey(notice.chatId, notice.threadId || 0), null, config);
          await send(
            notice.chatId,
            `✅ ${t(lang, 'msg.restarted', { pid: process.pid })}`,
            notice.threadId || 0,
          );
        }
      }
    } catch (error) {
      log(`restart notice failed: ${error.message}`);
    }
    for (const id of config.allowedUserIds) {
      try { await send(id, `🤖 ${t(config.lang || 'en', 'msg.started')}`); } catch {}
    }
  } catch (error) {
    log(`startup notice failed: ${error.message}`);
  }

  /** One update: journal first, then the turn, then ack after delivery. */
  const accept = (update, replay = false) => {
    const msg = update.message;
    if (!msg) {
      ack(update.update_id);
      return;
    }
    // The allowlist has to be the first thing every update meets, not a step
    // inside handleMessage: the steer branch below reaches the running agent
    // without going through handleMessage, so a stranger the bot can see used
    // to be able to inject text into the owner's live turn.
    if (!allowedSender(msg, config)) {
      log(`ignored update from ${msg.from?.id} (chat ${msg.chat?.id}${msg.message_thread_id ? ` topic=${msg.message_thread_id}` : ''}) allowlist=${JSON.stringify(config.allowedUserIds ?? [])}`);
      ack(update.update_id);
      return;
    }
    const queueKey = sessionKey(msg.chat.id, threadOf(msg));
    const thread = threadOf(msg);
    // `/stop` behind the turn it should kill is a no-op; run the few commands
    // that only read or kill state outside the per-topic queue.
    const immediate = immediateCommandOf(msg.text ?? '');
    if (immediate) {
      log(`command ${immediate} handled outside the queue`);
      Promise.resolve()
        .then(() => handleMessage(msg))
        .then(() => ack(update.update_id))
        .catch((error) => log(`command ${immediate} failed: ${error.message}`));
      return;
    }
    // Telegram splits an album into one update per file, all sharing a
    // `media_group_id`. Buffering them for a moment turns "ten photos" into one
    // hand-over instead of ten steers or ten turns.
    if (msg.media_group_id) {
      ack(update.update_id);
      bufferAlbum(msg);
      return;
    }
    // A plain message during a running turn is an addition to that work, not a
    // new turn: steer it into the live agent instead of queueing it behind the
    // very turn it is meant to change. Voice notes, photos and files count as
    // additions too — they are converted to text first, exactly as an idle
    // turn would convert them.
    const steerText = (msg.text || '').trim();
    // A caption rides along with the file; it must not turn the attachment into
    // a text-only steer, or the file itself is silently dropped.
    const steerMedia = Boolean(msg.voice || msg.audio || msg.photo || msg.document || msg.video || msg.video_note || msg.animation);
    if ((steerText || steerMedia) && !steerText.startsWith('/') && config.steerDuringTurn !== false && steerAvailable(profileOf(queueKey))) {
      const sessionId = liveSessions.get(queueKey) || state.sessions[queueKey];
      if (activeTurns.has(queueKey) && sessionId) {
        if (steerText && !steerMedia) {
          try {
            const job = steerRunningTurn(msg, steerText, sessionId, thread, deliverTurn);
            log(`steer handled outside the queue: ${job.id}`);
            ack(update.update_id);
          } catch (error) {
            log(`steer write failed: ${error.message}`);
          }
          return;
        }
        // Transcription and downloads take seconds; the update loop must not
        // wait for them. The turn may finish meanwhile, and `steerMediaMessage`
        // then runs the prepared text as a turn of its own instead of leaving
        // the voicemail in a directory nobody reads again.
        ack(update.update_id);
        const lang = resolveLang(state, queueKey, msg, config);
        void steerMediaMessage(msg, sessionId, queueKey, thread, lang, deliverTurn).catch((error) => {
          // The attachment could not be prepared (download, transcription). It
          // still deserves an answer, so let the normal path take it: it retries
          // the same work and reports the failure itself.
          log(`steer media failed, queueing a normal turn: ${error.message}`);
          enqueue(queueKey, () => handleMessage(msg));
        });
        return;
      }
    }
    enqueue(
      queueKey,
      async () => {
        try {
          await handleMessage(msg);
          // handleMessage returns only after the reply reached Telegram (or the
          // turn failed loudly), so this is the correct moment to forget it.
          ack(update.update_id);
          if (replay) log(`replayed update ${update.update_id} after restart`);
        } catch (error) {
          // Keep the pending file: the next start retries it once.
          log(`turn error for update ${update.update_id}: ${error.message}`);
        }
      },
      // Only plain text prompts can queue behind a turn; commands are
      // handled inline and must stay silent about it.
      msg.text || msg.caption
        ? async () => {
            // Which turn was running when this message was queued: if that
            // value changes, the queued turn has started and the notice is
            // already obsolete.
            const turnWhenQueued = turnStartedAt.get(queueKey);
            await new Promise((resolve) => setTimeout(resolve, Number(config.busyNoticeMs ?? 45000)));
            if (!queues.has(queueKey)) return; // already finished
            // One notice per topic: a second queued message must not add a
            // second copy of the same line.
            if (busyNotices.has(queueKey)) return;
            const started = turnStartedAt.get(queueKey);
            const mins = started ? Math.max(1, Math.round((Date.now() - started) / 60000)) : 0;
            const notice = mins > 0
              ? t(lang, 'msg.busy.since', { min: mins })
              : t(lang, 'msg.busy.now');
            const messageId = await send(
              msg.chat.id,
              `⏳ ${notice}`,
              thread,
            );
            if (messageId) busyNotices.set(queueKey, { chatId: msg.chat.id, messageId });
            // The queued turn may have started while the notice was in flight;
            // in that case nothing else will delete it until the turn ends.
            if (noticeIsObsolete(turnWhenQueued, turnStartedAt.get(queueKey), queues.has(queueKey))) {
              await clearBusyNotice(queueKey);
            }
          }
        : undefined,
    );
  };

  // Replay anything the previous process owed an answer. Runs before polling so
  // a crash mid-turn costs one duplicate-free retry, not a lost message.
  //
  // One bad entry must not become a restart loop: `accept` throwing here used to
  // leave the update pending forever, so the bridge replayed it, died, and was
  // restarted by the supervisor — every ninety seconds, with a stack trace and
  // nothing else. Drop the entry after reporting it.
  const owed = pendingUpdates();
  if (owed.length > 0) {
    log(`replaying ${owed.length} pending update(s) from the journal`);
    for (const { update } of owed) {
      try {
        accept(update, true);
      } catch (error) {
        log(`replay of update ${update?.update_id} failed, dropping it: ${error.message}`);
        ack(update?.update_id);
      }
    }
  }

  let pollFailures = 0;
  // Release and failure notices ride the poll loop's own idle: they are one
  // message every few hours at most, and a timer would keep the process awake
  // for nothing. The first check runs a few minutes after a start, so a
  // restarting machine does not hit the registry on every boot.
  const notice = { mode: '', startAt: Date.now() + 3 * 60 * 1000 };
  const noticeMode = () => (state.update && typeof state.update.mode === 'string' ? state.update.mode : 'check');
  /** Where a notice goes: the chat that last ran a turn. */
  const noticeTarget = () => lastTurnTarget();
  const maybeNotice = async () => {
    try {
      const target = noticeTarget();
      if (!target) return;
      const mode = noticeMode();
      const checkedAt = Number(state.update?.checkedAt) || 0;
      if (mode === 'off' || !dueForCheck({ mode, checkedAt, now: Date.now() })) return;
      // One attempt per interval, even if it fails: an offline laptop must not
      // retry the registry on every poll.
      state.update = { ...(state.update || {}), checkedAt: Date.now() };
      saveState();
      const latest = await npmLatestAsync();
      if (!latest) return;
      const lang = langFor(target.chatId, target.threadId);
      const result = updateState({ installed: bridgeVersion(), latest, mode, notified: state.update?.notified || '' });
      if (result.auto) {
        // The files change, the running process does not: the person still says
        // when the new code loads, so a bad release never arrives mid-chat.
        const backup = installRelease(latest);
        state.update = { ...(state.update || {}), notified: latest };
        saveState();
        await send(target.chatId, t(lang, 'ctrl.update.done', { v: latest }) + '\n' + t(lang, 'ctrl.update.backup', { path: join(DIR, backup) }), target.threadId);
        return;
      }
      if (!result.notify) return;
      state.update = { ...(state.update || {}), notified: latest };
      saveState();
      await send(target.chatId, t(lang, 'ctrl.subscribe.notice', { v: latest }), target.threadId);
    } catch (error) {
      log(`update notice skipped: ${error.message}`);
    }
  };
  for (;;) {
    if (Date.now() >= notice.startAt) {
      notice.startAt = Date.now() + 15 * 60 * 1000;
      if (notice.mode !== noticeMode()) notice.startAt = Date.now() + 3 * 60 * 1000;
      notice.mode = noticeMode();
      void maybeNotice();
    }
    try {
      // `callback_query` is required for inline buttons: without it Telegram
      // never delivers button presses, so «Стоп» would draw but do nothing.
      const updates = await tg('getUpdates', { offset: state.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 120000);
      if (pollFailures > 0) { log(`poll recovered after ${pollFailures} failure(s)`); pollFailures = 0; }
      for (const update of updates) {
        if (update.callback_query) {
          // Buttons are handled inline and immediately: they are neither
          // journaled nor queued, because a stale button must answer at once.
          state.offset = Math.max(state.offset, update.update_id + 1);
          saveState();
          try {
            await handleCallback(update.callback_query);
          } catch (error) {
            log(`callback error: ${error.message}`);
          }
          continue;
        }
        // Journal BEFORE the offset moves: the reverse order is what silently
        // ate messages whenever the process died mid-turn.
        writePending(update);
        state.offset = Math.max(state.offset, update.update_id + 1);
        saveState();
        accept(update);
      }
    } catch (error) {
      const msg = String(error?.message ?? error);
      const code = /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up/i.test(msg)
        ? 'TG_NET'
        : 'TG_POLL';
      pollFailures += 1;
      const waitMs = Math.min(30000, 5000 * 2 ** Math.min(pollFailures - 1, 3));
      log(`poll error [${code}]: ${msg} — retry in ${Math.round(waitMs / 1000)}s`
        + (code === 'TG_NET' ? ' (hint: check IPv4 route / VPN)' : ''));
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

main();
