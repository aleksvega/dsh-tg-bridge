// Topic identity: which chat, which forum topic, and the key that names a session.
//
// Small and dependency-free on purpose. `sessionKey` is used by the language
// resolver, the state file, the queue and the turn runner; before this file
// existed, anything that needed it had to import the whole poller.
//
// This module grows in step 3 of `openspec/changes/split-giant-files` — topic
// names, seeds and the General log land here. It must not import `bridge.mjs`,
// directly or through a chain.

/** Forum topic id of a message, or 0 for General and for private chats. */
export function threadOf(msg) {
  const id = msg.message_thread_id ?? msg.reply_to_message?.message_thread_id;
  return Number.isInteger(id) && id > 0 ? id : 0;
}

/** One DSH session per chat, and per topic inside a forum supergroup. */
export function sessionKey(chatId, threadId) {
  return threadId > 0 ? `${chatId}:${threadId}` : String(chatId);
}
