// The Telegram transport: one place that knows the token, the URL, the retries
// and the message shapes.
//
// Everything the bridge says to Telegram goes through `send` or `sendWithMarkup`
// here, so a failure mode fixed once (IPv6, HTML rejection, a thread id that
// would drop the reply into General) stays fixed for every caller.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { token } from './secrets.mjs';
import { config, log } from './state.mjs';
import { langFor } from './commands.mjs';
import { DIR } from './paths.mjs';
import { chunk, markdownParts, toPlainText, toTelegramHtml } from './format.mjs';
import { t } from './i18n.mjs';

export const api = (method) => `https://api.telegram.org/bot${token}/${method}`;

/**
 * Telegram API call with retries.
 *
 * The log filled with `poll error: fetch failed` for an hour while
 * api.telegram.org was reachable over IPv4: Node's fetch tries the AAAA record
 * first and fails, and a single failed attempt used to drop the message or the
 * reply entirely. Three attempts with backoff turn a flaky network into a
 * short delay instead of silence.
 */
export async function tg(method, body, timeoutMs = 60000, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(api(method), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.ok) throw new Error(`${method}: ${json.description || res.status}`);
      return json.result;
    } catch (error) {
      lastError = error;
      const retryable = /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|502|503|504/i.test(String(error?.message ?? error));
      if (!retryable || attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

/**
 * A press has someone watching a spinner, so its calls must fail in seconds.
 *
 * `tg` waits 60 s and tries three times: that is up to three minutes for one
 * press, and the person sees a spinner that never stops. Nobody waits that long;
 * they press again, which starts a second copy of the same wait, and the chat
 * fills with cards that answer out of order. Two short attempts keep the tap
 * fast and still ride out the flaky route the retries exist for.
 */
export const tgFast = (method, body) => tg(method, body, 8000, 2);

/**
 * Upload a local file to the chat: archives, PDFs, screenshots, builds.
 */
export async function sendFile(chatId, threadId, filePath, caption = '') {
  const buf = readFileSync(filePath);
  const form = new FormData();
  form.set('chat_id', String(chatId));
  if (threadId > 0) form.set('message_thread_id', String(threadId));
  if (caption) form.set('caption', caption.slice(0, 1000));
  form.set('document', new Blob([buf]), basename(filePath));
  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`sendDocument: ${json.description || res.status}`);
  log(`sent file ${basename(filePath)} (${buf.length} B) chat=${chatId}`);
  return json.result;
}

/**
 * Download a Telegram file into the bridge dir under a stable name.
 * Voice notes arrive as OGG/Opus, which the local ASR CLI does not decode,
 * so the caller passes the name it wants (including the extension).
 */
export async function downloadFile(fileId, fileName) {
  const file = await tg('getFile', { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!res.ok) throw new Error(`file download failed: ${res.status}`);
  const path = join(DIR, fileName);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

/**
 * A message that carries buttons. Inline rows are the usual case; a persistent
 * reply keyboard (`/menu on`) and taking it away again are the two other markup
 * shapes a person can end up with, so every call site hands its intent here
 * instead of building `reply_markup` itself.
 */
/**
 * Rows of buttons, in the one shape Telegram accepts.
 *
 * The cards build buttons as `{ text, data }` — a payload, not a Telegram field,
 * because the card does not know or care where it will be drawn. Telegram wants
 * `callback_data` and rejects the *whole message* with "Text buttons are not
 * allowed in the inline keyboard" when it sees `data` instead. That rejection was
 * swallowed by the `.catch(() => {})` on every send, so `/menu`, `/settings` and
 * the task card drew nothing at all and said nothing about it.
 *
 * One conversion here, at the edge, so a card can keep its own vocabulary.
 */
export function inlineKeyboard(rows) {
  if (!Array.isArray(rows)) return rows;
  const out = [];
  for (const row of rows) {
    if (!Array.isArray(row)) { out.push(row); continue; }
    const buttons = [];
    for (const button of row) {
      if (!button || typeof button !== 'object') { buttons.push(button); continue; }
      const { data, ...rest } = button;
      const payload = rest.callback_data ?? rest.url ?? rest.web_app ?? data;
      // A button with neither a payload nor a link is a label Telegram refuses —
      // and it refuses the whole message, not the button.
      if (payload === undefined) continue;
      buttons.push(rest.callback_data !== undefined || rest.url !== undefined || rest.web_app !== undefined
        ? rest
        : { ...rest, callback_data: String(payload) });
    }
    if (buttons.length > 0) out.push(buttons);
  }
  return out;
}

export async function sendWithMarkup(chatId, threadId, text, extra = {}) {
  const thread = threadId > 0 ? { message_thread_id: threadId } : {};
  if (extra.removeKeyboard) {
    return tg('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: { remove_keyboard: true },
      ...thread,
    }).catch(() => {});
  }
  if (extra.persistent) {
    return tg('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: { keyboard: extra.persistent, resize_keyboard: true, is_persistent: true },
      ...thread,
    }).catch(() => {});
  }
  if (extra.keyboard) {
    return tg('sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: inlineKeyboard(extra.keyboard) },
      ...thread,
    }).catch((error) => {
      // Silence here cost a release: the card never appeared and the log said
      // nothing. A keyboard Telegram refuses is a bug in this repo, so say which
      // button it was and still deliver the text without buttons.
      log(`inline keyboard rejected (${String(error.message).slice(0, 160)}); sending without buttons`);
      return tg('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true, ...thread }).catch(() => {});
    });
  }
  return send(chatId, text, threadId);
}

export async function send(chatId, text, threadId = 0, replyTo = 0) {
  // Who is reading: the topic's language decides even the fallback line, so an
  // English or Chinese topic never sees a Russian placeholder.
  const lang = langFor(chatId, threadId);
  const plain = config.plainText === true;
  const parts = plain
    ? chunk(toPlainText(text) || t(lang, 'bridge.progress.empty'), 3800)
    : markdownParts(text);
  let lastId = 0;
  for (const part of parts) {
    const html = plain ? '' : toTelegramHtml(part);
    const body = { chat_id: chatId, text: html || part, disable_web_page_preview: true };
    if (html) body.parse_mode = 'HTML';
    // Without message_thread_id every reply lands in the General topic, which is
    // the whole point of carrying the thread through.
    if (threadId > 0) body.message_thread_id = threadId;
    if (replyTo > 0) body.reply_to_message_id = replyTo;
    let res;
    try {
      res = await tg('sendMessage', body);
    } catch (error) {
      // The fallback must start from the markdown, not from the HTML: resending
      // the markup as plain text is exactly how the person ends up reading
      // `<b>` and `<code>` instead of a sentence.
      if (!html) throw error;
      log(`html send failed (${String(error.message).slice(0, 120)}); resending as plain text`);
      delete body.parse_mode;
      for (const piece of chunk(toPlainText(part) || t(lang, 'bridge.progress.empty'), 3800)) {
        body.text = piece;
        res = await tg('sendMessage', body);
      }
    }
    log(`sent chat=${chatId}${threadId ? ` topic=${threadId}` : ''} msg=${res.message_id} len=${body.text.length}${html ? ' html' : ''}`);
    lastId = res.message_id;
  }
  return lastId;
}

/**
 * Send a message that deletes itself after `ttlMs`.
 *
 * Reports read once and forgotten (`/thoughts`, an unknown command showing the
 * menu) should not stay in the scrollback forever. The API cannot edit plain
 * text into a spoiler, so the choice is between two kinds of litter: a long
 * reply or a "gone" tombstone. A tombstone wins.
 */
export async function sendEphemeral(chatId, text, threadId = 0, replyTo = 0, ttlMs = 180000) {
  const id = await send(chatId, text, threadId, replyTo);
  if (!id) return id;
  const timer = setTimeout(() => {
    tg('deleteMessage', { chat_id: chatId, message_id: id })
      .catch((error) => log(`ephemeral delete failed msg=${id}: ${String(error.message).slice(0, 80)}`));
  }, ttlMs);
  timer.unref?.();
  return id;
}
