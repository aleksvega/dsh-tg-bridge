// Mid-turn steers: an addition typed while a turn is already running.
//
// The turn is a separate process, so a steer is a job file the `steer-inbox`
// plugin picks up. Every path here also has to survive the turn ending first,
// which is why each one either watches the job or hands it back as a turn of
// its own: the caller passes `deliver` for that, because the queue and the
// message handler live one level up.
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { writeSteerJob } from './steer-queue.mjs';
import { DSH_HOME, SAY, STEER_DIR } from './paths.mjs';
import { config, log, state } from './state.mjs';
import { resolveLang, t } from './i18n.mjs';
import { sessionKey } from './keys.mjs';
import { activeTurns } from './turn.mjs';
import { send } from './telegram.mjs';
import { mediaPrompt } from './media.mjs';
/**
 * Queue notices, one per topic. A notice exists only while the person is
 * waiting: the moment the queued turn starts it is deleted, so a long session
 * does not leave a column of "идёт уже 7 мин" messages behind (it did).
 */
export const busyNotices = new Map();

export async function clearBusyNotice(key) {
  const notice = busyNotices.get(key);
  if (!notice) return;
  busyNotices.delete(key);
  try {
    await tg('deleteMessage', { chat_id: notice.chatId, message_id: notice.messageId });
  } catch (error) {
    log(`busy notice delete failed: ${error.message}`);
  }
}

/**
 * Whether this profile can receive mid-turn steers. The bridge only writes a
 * job when the `steer-inbox` plugin is actually wired into the profile; without
 * it the file would sit unread until it expired, and the message would be lost.
 * In that case the message queues the old way.
 */
let steerReady;
export function steerAvailable(profile = config.profile || 'headless') {
  if (steerReady !== undefined && steerReady.profile === profile) return steerReady.ready;
  try {
    const patch = readFileSync(join(DSH_HOME, 'profiles', profile, 'cordis.patch.yml'), 'utf8');
    steerReady = { profile, ready: /steer-inbox/.test(patch) };
  } catch {
    steerReady = { profile, ready: false };
  }
  return steerReady.ready;
}

/**
 * Hand a message to the turn that is already running.
 *
 * The turn is a separate process, so the bridge writes a job the `steer-inbox`
 * plugin picks up and feeds to `agent.steer()` — next-step input. The agent is
 * told (in the job, by the plugin) to send one short line into the chat via
 * say.mjs; the fallback below covers a model that stays silent.
 */
export function steerRunningTurn(msg, text, sessionId, thread, deliver) {
  const key = sessionKey(msg.chat.id, thread);
  const lang = resolveLang(state, key, msg, config);
  const job = writeSteerJob(STEER_DIR, {
    sessionId,
    text,
    chatId: msg.chat.id,
    threadId: thread,
    lang,
    say: SAY,
  });
  log(`steer ${job.id} -> ${sessionId} (${text.length} chars)`);
  // Confirm the moment the job is written, not 90 seconds later. The plugin
  // hands it to the running agent at its next step, and a step can be a
  // six-minute test run: without this line the addition looked lost, which is
  // exactly what "steer стала хуже" describes. The wait notice below then only
  // speaks when the job really has not been picked up.
  send(msg.chat.id, t(lang, 'steer.queued'), thread).catch(() => {});
  watchSteer(job, msg, text, thread, lang, deliver);
  return job;
}

/**
 * Follow one steer job until it is either acknowledged by the model or taken by
 * the plugin.
 *
 * Two failure modes need cover: a model that stays silent (one neutral line
 * after 90 s), and a job that never reached the agent because the turn ended
 * first — that addition must become its own turn instead of expiring unseen in
 * the directory.
 */
export function watchSteer(job, msg, text, thread, lang, deliver) {
  const key = sessionKey(msg.chat.id, thread);
  const acked = () => existsSync(join(STEER_DIR, 'acks', `${job.id}.json`));
  const consumed = () => existsSync(join(STEER_DIR, 'done', `${job.id}.json`));
  const check = async (attempt) => {
    try {
      if (acked() || consumed()) return;
      if (activeTurns.has(key)) {
        if (attempt === 0) {
          log(`steer ${job.id} unacknowledged after 90s; sending fallback`);
          await send(msg.chat.id, t(lang, 'steer.ackFallback'), thread);
        }
        setTimeout(() => check(attempt + 1), 60_000).unref?.();
        return;
      }
      // The turn is over and the plugin never picked the job up: deliver it as
      // a turn of its own, otherwise the person's addition is silently lost.
      const pending = join(STEER_DIR, `${job.id}.json`);
      if (!existsSync(pending)) return;
      try { unlinkSync(pending); } catch {}
      log(`steer ${job.id} not consumed by the turn; re-queued as a new turn`);
      deliver(key, {
        chat: msg.chat,
        from: msg.from,
        message_id: 0,
        message_thread_id: thread || undefined,
        is_topic_message: thread > 0,
        text,
      });
    } catch (error) {
      log(`steer watch failed for ${job.id}: ${error.message}`);
    }
  };
  setTimeout(() => check(0), 90_000).unref?.();
}

/**
 * Attachment sent while a turn is running: transcribe/download it first, then
 * steer the resulting text into the same turn. Echoing the transcript is the
 * only confirmation the person gets that the audio was understood, so the
 * helper does that before the steer is written.
 */
export async function steerMediaMessage(msgs, sessionId, key, thread, lang, deliver) {
  const list = Array.isArray(msgs) ? msgs : [msgs];
  const first = list[0];
  const wasRunning = activeTurns.has(key);
  const built = await mediaPrompt(list, first.chat.id, thread, lang, {
    steer: true,
    stillRunning: () => activeTurns.has(key),
  });
  if (!built.text) {
    log('steer media produced no text; nothing injected');
    return;
  }
  if (activeTurns.has(key)) {
    steerRunningTurn(first, built.text, sessionId, thread, deliver);
    return;
  }
  // Transcribing and downloading take seconds; the turn this addition was meant
  // for may already be gone. Writing the job anyway left the addition in the
  // directory until `watchSteer` noticed — a minute of silence for a voice note
  // that arrived half a second too late. The prepared text (transcript, file
  // path, caption) is already the whole request, so run it as its own turn.
  log(`steer media: turn ended during prep (was ${wasRunning ? 'running' : 'gone'}), delivering as a turn (${key})`);
  deliver(key, {
    chat: first.chat,
    from: first.from,
    message_id: 0,
    message_thread_id: thread || undefined,
    is_topic_message: thread > 0,
    text: built.text,
  });
}
