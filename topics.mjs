// Forums: which topic a chat is working in, and what the bridge says about a
// topic outside it.
//
// A forum supergroup is a lobby plus one thread per project, and the bridge has
// three jobs around that: recover the topic a General message really belongs to,
// seed a brand-new topic so it is not a title over an empty page, and write one
// pointer line into General instead of the whole prompt. All three talk to
// Telegram, so this module sits above `telegram.mjs` — it must never be imported
// by it.
import { sessionKey } from './keys.mjs';
import { config, log, saveState, state } from './state.mjs';
import { tg } from './telegram.mjs';
import { t } from './i18n.mjs';

/**
 * Last topic this chat actually worked in.
 *
 * Mirrors Hermes' `_recover_telegram_topic_thread_id`: when a message arrives
 * without a thread id (Telegram omits it for General and for clients that have
 * not bound the topic yet), routing it to the root session silently forks the
 * conversation. Recovering the newest bound topic keeps one project in one
 * place instead of scattering it between General and its topic.
 */
export function newestBoundTopic(chatId) {
  let newest = 0;
  let at = 0;
  for (const key of Object.keys(state.sessions ?? {})) {
    const match = new RegExp(`^${chatId}:(\\d+)$`).exec(key);
    if (!match) continue;
    const stamped = state.topicTouched?.[match[1]] ?? 0;
    if (stamped > at) {
      at = stamped;
      newest = Number(match[1]);
    }
  }
  return newest;
}

/** Remember that a topic is active, for {@link newestBoundTopic}. */
export function touchTopic(threadId) {
  if (!(threadId > 0)) return;
  state.topicTouched = state.topicTouched ?? {};
  state.topicTouched[String(threadId)] = Date.now();
}

/**
 * Recent topic seeds, so a duplicate of the same text arriving in the General
 * chat can be recognised instead of starting a second turn.
 *
 * Telegram delivers a brand-new topic's text twice: once as the topic message
 * and once as a plain group message. Both used to run a turn, which is why a
 * prompt written in General got answered in General while its topic stayed
 * empty.
 */
const recentSeeds = new Map();

export function noteSeed(text, threadId) {
  const key = String(text ?? '').trim().slice(0, 200);
  if (!key) return;
  recentSeeds.set(key, { threadId, at: Date.now() });
  for (const [candidate, value] of recentSeeds) {
    if (Date.now() - value.at > 600000) recentSeeds.delete(candidate);
  }
}

/** Topic id whose seed carried this same text within the last ten minutes, or 0. */
export function topicSeededRecently(text) {
  const key = String(text ?? '').trim().slice(0, 200);
  if (!key) return 0;
  const hit = recentSeeds.get(key);
  return hit && Date.now() - hit.at < 600000 ? hit.threadId : 0;
}

/**
 * The forum topic's own title, for a card that has to say where it is.
 *
 * Cache-first and fire-and-forget: `getForumTopic` is a request per call and the
 * first render would otherwise block on a name that only decorates a line. The
 * first call returns '' and fills the cache for the next one — panels re-render
 * on every edit. A failure caches the empty name — a card is not worth a retry
 * storm — and the caller renders the id alone.
 */
const topicNames = new Map();

export function topicName(chatId, threadId) {
  const cacheKey = sessionKey(chatId, threadId);
  if (topicNames.has(cacheKey)) return topicNames.get(cacheKey);
  topicNames.set(cacheKey, '');
  tg('getForumTopic', { chat_id: chatId, message_thread_id: threadId })
    .then((res) => {
      const name = String(res?.name || '').trim();
      if (name) topicNames.set(cacheKey, name);
    })
    .catch(() => {});
  return '';
}

/** Remember which topics already got their seed message, so it happens once. */
export function topicSeeded(threadId) {
  return Boolean(state.seededTopics?.[String(threadId)]);
}

/**
 * Seed a newly created forum topic with the person's own message and pin it.
 *
 * Telegram creates a topic with only a service message ("Topic created"), so
 * the thread looks empty: a title with nothing under it. Posting the incoming
 * text there (a) removes the blank, (b) gives the chat something to scroll
 * back to, and (c) pins the thread to the top of the topic list, which is the
 * behaviour the owner asked for.
 *
 * Returns the seeded message id, or 0 when nothing was done.
 */
export async function ensureTopicSeed(chatId, threadId, text) {
  if (topicSeeded(threadId)) return 0;
  const body = { chat_id: chatId, text: String(text ?? '').slice(0, 4000), message_thread_id: threadId, disable_web_page_preview: true };
  let messageId = 0;
  try {
    const res = await tg('sendMessage', body);
    messageId = res.message_id;
  } catch (error) {
    log(`topic ${threadId} seed failed: ${error.message}`);
    return 0;
  }
  if (config.pinTopicSeed !== false) {
    try {
      await tg('pinChatMessage', { chat_id: chatId, message_id: messageId, disable_notification: false });
    } catch (error) {
      log(`topic ${threadId} pin failed: ${error.message}`);
    }
  }
  state.seededTopics = state.seededTopics ?? {};
  state.seededTopics[String(threadId)] = messageId;
  saveState();
  noteSeed(text, threadId);
  return messageId;
}

/**
 * Write one line about a new topic into the General chat, so the main stream
 * reads as a log of what was started instead of a wall of prompts. The full
 * text lives in the topic itself; this is only the pointer.
 */
export async function logTopicToGeneral(chatId, threadId, text, lang = config.lang || 'en') {
  if (config.topicLog === false) return;
  const head = String(text ?? '').replace(/\s+/g, ' ').trim();
  const preview = head.length > 90 ? `${head.slice(0, 90)}…` : head;
  try {
    await tg('sendMessage', {
      chat_id: chatId,
      text: t(lang, 'msg.topicLog', { preview }),
      disable_web_page_preview: true,
    });
    log(`topic ${threadId} logged to General`);
  } catch (error) {
    log(`topic ${threadId} General log failed: ${error.message}`);
  }
}
