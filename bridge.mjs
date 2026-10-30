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
import { noticeIsObsolete } from './turn/queue-notice.mjs';
import { immediateKind } from './turn/immediate.mjs';
import { writeSteerJob } from './turn/steer-queue.mjs';
import { allowedSender } from './core/allowlist.mjs';
import { inlineText } from './chat/media-text.mjs';
import { createAlbumBuffer } from './chat/albums.mjs';
import { turnArgs } from './core/cli-args.mjs';
import { chunk, markdownParts, toPlainText, toTelegramHtml } from './core/format.mjs';
import { mediaPrompt, readVoiceIntoText } from './chat/media.mjs';
import { busyNotices, clearBusyNotice, steerAvailable, steerMediaMessage, steerRunningTurn } from './turn/steer.mjs';
import { MAX_PARALLEL, approvals, bufferAlbum, enqueue, lastPrompt, queues, redeliver, rewindUsed, setMessageHandler } from './turn/queue.mjs';
import { applyAsetJob, settingsChipOf, turnProfileOf } from './profile/profile-view.mjs';
import { handleMessage } from './chat/handle-message.mjs';
import { answerPressFailed, handleCallback, renderTaskCard, taskRows } from './chat/callbacks.mjs';
import { boundSetOf, handleCardPress } from './profile/settings-press.mjs';
import { runCommandFromButton } from './core/run-command.mjs';
import { startJobLoops } from './turn/job-loops.mjs';
import { ensureProfile } from './profile/profiles.mjs';
import { firstLiveModel, describeVerdicts, probeHint, probeModel } from './model/model-probe.mjs';
import { explainFailure } from './turn/failures.mjs';
import { handleControl, CONTROL_COMMANDS, modelOf, modelsOf } from './chat/control.mjs';
import { bridgeVersion, installRelease, npmLatestAsync } from './chat/control.mjs';
import { dueForCheck, updateState } from './core/update-policy.mjs';
import { drainGoalJobs, goalOf, progressOf, renderPromptBlock, toggleTask } from './work/goals.mjs';
import { renderPrices } from './model/prices.mjs';
import { t, resolveLang } from './core/i18n.mjs';
import { progressPanel, stepLine, addStep } from './chat/panel.mjs';
import { AgentsetStore } from './profile/agentsets.mjs';
import { profileValues, resolveSettings, settingsChip } from './profile/settings.mjs';
import { parseAgentPresets, parsePermissionPresets, parseReasoningEfforts } from './profile/agents.mjs';
import { drainAsetJobs } from './turn/aset-jobs.mjs';
import { materialiseProfile, pruneDerived } from './profile/aset-profile.mjs';
import { parseCallback } from './profile/aset-schema.mjs';
import { commandFor, renderSettingsCard, settingsCurrent } from './profile/settings-card.mjs';
import { answerRewindPress, cutSession, isRewindPress } from './work/rewind-buttons.mjs';
import { applyRewind, newestBackup, restoreBackup } from './work/rewind.mjs';
import { sessionFile } from './chat/thoughts.mjs';
import { MENU_PREFIX, commandForName, isMenuPress, keyboardCommand, menuTarget, renderPanel, runsUnasked } from './chat/menu-card.mjs';
import {
  APP, CLI_JS, CRED, DIR, DONE_FILE, DONE_TTL_MS, DSH_HOME, EXE, GOAL_CMD, HOME, LOG,
  PENDING_DIR, PID_FILE, RESTART_MARKER, RESTART_NOTICE, SAY, SELF_DIR, STATE, STEER_DIR,
  THOUGHT_DIR,
} from './core/paths.mjs';
import {
  ack, config, done, log, pendingPath, pendingUpdates, saveDone, saveState, state, writeAtomic, writePending,
} from './core/state.mjs';
import { findToken, providerKeys, readSecret, token } from './core/secrets.mjs';
import { GENERAL_SAFE, commandOf, immediateCommandOf, langFor, lastTurnTarget, setBotUsername } from './chat/commands.mjs';
import { sessionKey, threadOf } from './core/keys.mjs';
import { speedOf, startProgress } from './turn/progress.mjs';
import { activeTurns, killTurn, liveSessions, profileOf, runTurn, runTurnLive, turnStartedAt, typingLoop } from './turn/turn.mjs';
import { approvalKeyboard, continueKeyboard, errorKeyboard } from './chat/keyboards.mjs';
import { ensureTopicSeed, logTopicToGeneral, newestBoundTopic, noteSeed, topicName, topicSeeded, topicSeededRecently, touchTopic } from './chat/topics.mjs';
import { downloadFile, send, sendEphemeral, sendFile, sendWithMarkup, tg } from './chat/telegram.mjs';

setMessageHandler(handleMessage);

/**
 * Run a command the same way a typed one runs, for a button that stands for it.
 * The callback handlers below need this: a press must reach `handleControl` with
 * exactly the context a typed command gets.
 */

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




startJobLoops();

if (!token) {
  log('FATAL: bot token not found — run `node cli.mjs init --token <t> --user <id>` or set DSH_TELEGRAM_BOT_TOKEN');
  process.exit(1);
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
          // A turn is a child process, so the restart killed it. The topic it was
          // working in is left with a card stuck on ⏳ and no reason for it: the
          // person there typed a message, walked away, and comes back to a card
          // that stopped moving. Say so where the work was, not only where the
          // restart was ordered.
          for (const place of Array.isArray(notice.interrupted) ? notice.interrupted : []) {
            if (place.chatId === notice.chatId && (place.threadId || 0) === (notice.threadId || 0)) continue;
            try {
              const there = resolveLang(state, sessionKey(place.chatId, place.threadId || 0), null, config);
              await send(place.chatId, `⚠️ ${t(there, 'msg.turnInterrupted')}`, place.threadId || 0);
            } catch (error) {
              log(`interrupted notice failed for ${place.chatId}:${place.threadId}: ${error.message}`);
            }
          }
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
        // A command that threw is answered by the log, not by a replay. Leaving
        // it pending meant every restart ran it again: `/update` installed the
        // release, died on an undefined name, was never acked, and the journal
        // replayed it four times — the chat got "already on 1.22.0" three times
        // for one typed command.
        .catch(async (error) => {
          log(`command ${immediate} failed: ${error.message}`);
          // The person typed a command and got nothing back: silence reads as
          // "still working". One line, then the update is done with.
          const lang = resolveLang(state, queueKey, msg, config);
          await send(
            msg.chat.id,
            t(lang, 'msg.commandFailed', { cmd: immediate, err: String(error.message).slice(0, 200) }),
            thread,
          ).catch(() => {});
          ack(update.update_id);
        });
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
            const job = steerRunningTurn(msg, steerText, sessionId, thread, redeliver);
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
        void steerMediaMessage(msg, sessionId, queueKey, thread, lang, redeliver).catch((error) => {
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
          // One retry, then the answer is owed by nobody: a turn that throws the
          // same way on every start would otherwise be replayed on every restart
          // until the TTL, filling the chat with identical failures.
          log(`turn error for update ${update.update_id}: ${error.message}${replay ? ' (already a retry, dropping)' : ''}`);
          if (replay) ack(update.update_id);
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
  //
  // And a replay is only for what was genuinely mid-flight. After a bad release
  // left nineteen updates unacked, the next start would have re-run a whole
  // evening of turns the owner had already been answered for — the same money
  // twice, in messages he had read. Age is the only signal the journal carries
  // that separates "we died under this" from "this was answered or abandoned
  // long ago", so anything older than the window is dropped and said out loud.
  const replayWindowMs = Number(config.replayWindowMs) > 0
    ? Number(config.replayWindowMs)
    : 10 * 60 * 1000;
  const owed = pendingUpdates();
  const now = Date.now();
  const fresh = owed.filter(({ at }) => !at || now - at <= replayWindowMs);
  const stale = owed.filter(({ at }) => at && now - at > replayWindowMs);
  if (stale.length > 0) {
    log(`dropping ${stale.length} pending update(s) older than ${Math.round(replayWindowMs / 60000)} min: ${stale.map(({ id }) => id).join(', ')}`);
    for (const { id } of stale) ack(id);
  }
  if (fresh.length > 0) {
    log(`replaying ${fresh.length} pending update(s) from the journal`);
    for (const { update } of fresh) {
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
        const result = installRelease(latest);
        // An automatic update that would not load is rolled back and announced:
        // staying silent would leave the person on an old version with no idea
        // why, and the notice is the only place they could learn about it.
        if (result.rolledBack) {
          await send(target.chatId, t(lang, 'ctrl.update.broken', { v: latest }) + '\n\n' + result.problems.slice(0, 6).join('\n'), target.threadId);
          return;
        }
        state.update = { ...(state.update || {}), notified: latest };
        saveState();
        await send(target.chatId, t(lang, 'ctrl.update.done', { v: latest }) + '\n' + t(lang, 'ctrl.update.backup', { path: join(DIR, result.backup) }), target.threadId);
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
            await answerPressFailed(update.callback_query);
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
