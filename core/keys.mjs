// Which conversation a message belongs to.
//
// `sessionKey` is the identity used by the state file, the queue, the language
// resolver and the turn runner, so it lives below all of them: anything that
// needed it used to import the whole poller. Two functions, no imports — this
// module cannot join a cycle.

/** Forum topic id of a message, or 0 for General and for private chats. */
export function threadOf(msg) {
  const id = msg.message_thread_id ?? msg.reply_to_message?.message_thread_id;
  return Number.isInteger(id) && id > 0 ? id : 0;
}

/** One DSH session per chat, and per topic inside a forum supergroup. */
export function sessionKey(chatId, threadId) {
  return threadId > 0 ? `${chatId}:${threadId}` : String(chatId);
}
