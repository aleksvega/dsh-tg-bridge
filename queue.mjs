// Per-topic turn queue, albums and approval prompts.
//
// Everything here owns process-wide state on purpose: one turn at a time per
// topic, three Electron children at most, and the pending approvals a callback
// press resolves. Splitting this across modules would give each a private copy,
// which is why it lives in one place.
import { existsSync, unlinkSync } from 'node:fs';
import { createAlbumBuffer } from './albums.mjs';
import { approvalKeyboard } from './keyboards.mjs';
import { langFor } from './commands.mjs';
import { resolveLang, t } from './i18n.mjs';
import { sessionKey, threadOf } from './keys.mjs';
import { RESTART_MARKER } from './paths.mjs';
import { config, log, saveConfig, state } from './state.mjs';
import { busyNotices, clearBusyNotice, steerAvailable, steerMediaMessage } from './steer.mjs';
import { send, tg } from './telegram.mjs';
import { liveSessions, profileOf, turnStartedAt } from './turn.mjs';

/** The message handler is wired in by the entry module: it owns the turn. */
let handle = () => { throw new Error('queue: message handler is not wired'); };
export function setMessageHandler(fn) { handle = fn; }

/** A steer that outlived its turn becomes a turn of its own. */
export const redeliver = (key, message) => enqueue(key, () => handle(message));
// Per-topic turn queues: one turn at a time inside a topic, different topics run
// in parallel. Bounded, because every turn is a full Electron process.
export const queues = new Map();
export const waiting = [];
export let running = 0;
/** Default cap; `config.maxParallel` overrides it for one install. */
export const MAX_PARALLEL = 3;

/**
 * How many turns may run at once.
 *
 * Three was a guess that fit a small machine, and it is a real ceiling: with
 * three long turns in flight a fourth topic waited with no message at all, so a
 * prompt in a fresh topic looked exactly like a dead bot. The number is a
 * setting now, and waiting for a slot is announced (see `enqueue`).
 */
export function maxParallel() {
  const raw = Number(config?.maxParallel);
  if (!Number.isFinite(raw)) return MAX_PARALLEL;
  return Math.min(8, Math.max(1, Math.round(raw)));
}

export function acquire() {
  if (running < maxParallel()) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

export function release() {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
}

/**
 * Deferred restart: exit only when nothing is in flight.
 *
 * Killing the bridge from inside a turn kills that turn, so a code update used
 * to mean a lost answer. The protocol is: a `restart.pending` marker appears →
 * the bridge finishes the current work, lets the supervisor start a fresh
 * process, and only exits when the queue is empty. Exit code 75 is the signal a
 * supervisor recognises as "please start me again".
 */
export function maybeExitForRestart() {
  if (!existsSync(RESTART_MARKER)) return;
  if (running > 0 || queues.size > 0) return;
  log('restart.pending honoured: exiting 75 for the supervisor');
  try { unlinkSync(RESTART_MARKER); } catch {}
  setTimeout(() => process.exit(75), 300).unref?.();
}


// ------------------------------------------------------------------ albums
//
// Telegram delivers an album as one update per file, a few hundred ms apart,
// all sharing a `media_group_id`. Left alone, ten photos became ten steers (or
// ten turns): the person picked ten files and meant one request. Collect the
// group and hand it over once.

/** Quiet time after the last item before the album is handed over. */
const ALBUM_QUIET_MS = 1200;
/** Hard ceiling: a slow upload must not hold the batch forever. */
const ALBUM_MAX_MS = 4000;

export const albumBuffer = createAlbumBuffer({
  quietMs: ALBUM_QUIET_MS,
  maxMs: ALBUM_MAX_MS,
  onFlush: (msgs) => {
    void deliverAlbum(msgs);
  },
});

export function bufferAlbum(msg) {
  albumBuffer.push(`${msg.chat.id}:${threadOf(msg)}:${msg.media_group_id}`, msg);
}

/** One album -> one steer when a turn runs, otherwise one turn. */
export async function deliverAlbum(msgs) {
  const first = msgs[0];
  const key = sessionKey(first.chat.id, threadOf(first));
  const thread = threadOf(first);
  const lang = resolveLang(state, key, first, config);
  const sessionId = liveSessions.get(key) || state.sessions[key];
  log(`album ${first.media_group_id}: ${msgs.length} item(s) in ${key}`);
  // Decide at flush time, not at send time: the buffer holds the photos for up
  // to four seconds, and a turn that ended in that window must still get an
  // answer rather than a silent drop. `steerMediaMessage` re-checks on its own
  // and quotes the built prompt into a turn when the steered turn is gone.
  if (config.steerDuringTurn !== false && steerAvailable(profileOf(key)) && sessionId) {
    try {
      await steerMediaMessage(msgs, sessionId, key, thread, lang, redeliver);
      return;
    } catch (error) {
      log(`album steer failed, queueing a normal turn: ${error.message}`);
    }
  }
  enqueue(key, () => handle(first, msgs));
}

export function enqueue(key, task, onBusy) {
  const prev = queues.get(key) || Promise.resolve();
  const queued = queues.has(key);
  const run = prev
    .then(() => {
      // A turn waiting for a free slot used to wait in total silence: with three
      // long turns running, a prompt in a fourth topic showed nothing at all —
      // not even "queued" — so the bot looked dead in that topic. Say it once,
      // in the topic that is waiting; `clearBusyNotice` removes it when the turn
      // actually starts.
      if (!queued && running >= maxParallel()) {
        const [chatId, threadId] = String(key).split(':');
        const lang = resolveLang(state, key, null, config);
        Promise.resolve(send(chatId, t(lang, 'msg.slotWait', { max: maxParallel() }), Number(threadId) || 0))
          .then((messageId) => { if (messageId) busyNotices.set(key, { chatId, messageId }); })
          .catch(() => {});
      }
      return acquire();
    })
    .then(async () => {
      // The person was told "your message is queued"; that notice has done its
      // job the moment the turn starts and must not linger in the chat.
      await clearBusyNotice(key);
      // Remember when the turn actually started: the queue notice has to say
      // "идёт уже 24 мин", not just "занято" — silence is what reads as a hang.
      turnStartedAt.set(key, Date.now());
      return task();
    })
    .catch((error) => log(`turn queue error ${key}: ${error.message}`))
    .finally(() => {
      turnStartedAt.delete(key);
      clearBusyNotice(key).catch(() => {});
      release();
      if (queues.get(key) === run) queues.delete(key);
      // A deferred restart waits for exactly this moment: the answer is out and
      // the queue is empty.
      maybeExitForRestart();
    });
  // Say "this topic is busy" instead of leaving the person staring at silence:
  // a second message in the same topic waits for the first turn, which can be
  // minutes, and looked exactly like a hang.
  if (queued && typeof onBusy === 'function') {
    try {
      Promise.resolve(onBusy()).catch(() => {});
    } catch {}
  }
  queues.set(key, run);
  return run;
}

// ------------------------------------------------------------------ кнопки UI
//
// One place decides what each button means. The callback payload is short
// (`stop`, `retry`, `ap:a:1`) because Telegram caps it at 64 bytes; the context
// a press needs (which turn, which approval) lives in `uiState` below.

/** Last prompt per session key, so «Повторить» can resend it. */
export const lastPrompt = new Map();

/** Pending approval requests: id -> { key, chatId, threadId, resolve, timer. */
export const approvals = new Map();
// A rewind card is used once - a fast double tap must not cut twice.
export const rewindUsed = new Set();
export let approvalSeq = 0;

/**
 * Ask the person to confirm one action.
 *
 * The turn waits here until a button is pressed or the timeout fires, so a
 * prompt must never be left unanswered: an unanswered approval would hang the
 * queue forever.
 */
export function requestApproval(chatId, threadId, key, prompt) {
  const id = String(++approvalSeq);
  // The language of the topic the approval arrived in: an English chat must not
  // get Russian buttons on the question that decides whether the agent acts.
  const lang = langFor(chatId, threadId);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!approvals.has(id)) return;
      approvals.delete(id);
      resolve({ allowed: false, remember: false, expired: true });
    }, Number(config.approvalTimeoutMs ?? 600000));
    timer.unref?.();
    approvals.set(id, { chatId, threadId, key, resolve, timer, prompt });
    void tg('sendMessage', {
      chat_id: chatId,
      text: `${t(lang, 'bridge.approval.title')}\n${prompt}`,
      reply_markup: approvalKeyboard(id, lang),
      ...(threadId > 0 ? { message_thread_id: threadId } : {}),
    }).catch((error) => {
      log(`approval prompt failed: ${error.message}`);
      clearTimeout(timer);
      approvals.delete(id);
      resolve({ allowed: false, remember: false, expired: true });
    });
  });
}
