// Reading a message: is it a command, which command, and in which language.
//
// These four functions decided whether a message became a turn, so they lived in
// the middle of the poller where every one of their call sites could see the
// whole file. They are pure lookups over `state`/`config` — nothing here sends,
// nothing here spawns.
import { resolveLang } from '../core/i18n.mjs';
import { config, state } from '../core/state.mjs';
import { sessionKey } from '../core/keys.mjs';
import { immediateKind } from '../turn/immediate.mjs';

/**
 * The bot's own username, learned once from `getMe`.
 *
 * Mutable module state, deliberately: `commandOf` needs it to decide whether
 * `/new@some_other_bot` is ours, and the poller only learns the name after the
 * first API call. Exporting a setter instead of the variable keeps the one
 * writer visible.
 */
let botUsername = '';

export function setBotUsername(name) {
  botUsername = String(name || '');
}

export function currentBotUsername() {
  return botUsername;
}

/**
 * Normalized command name (`/new`), or '' for ordinary text.
 * In groups Telegram delivers `/new@deepifiya_bot`, which must still count.
 *
 * The pattern deliberately allows `-` and `.`: `/app-restart-confirm` and
 * `/app.restart.confirm` are what people actually type when they recall a
 * multi-word command, and returning '' for them silently ran a whole AI turn
 * instead (a real miss on 2026-10-20). Punctuation is dropped from the name.
 */
export function commandOf(text) {
  const match = /^\/([A-Za-z0-9_.-]+)(?:@([A-Za-z0-9_]+))?$/.exec(text);
  if (match === null) return '';
  if (match[2] && botUsername && match[2].toLowerCase() !== botUsername.toLowerCase()) return '';
  return `/${match[1].toLowerCase().replace(/[.-]+/g, '')}`;
}

/**
 * Commands that may run from the General topic without changing anything there.
 *
 * The lobby rule moves a General message into the newest topic; for these that is
 * the whole point (you want the status of the work you are looking at, and `/stop`
 * must work from anywhere). Everything else is answered in General with the name
 * of the topic it would have changed.
 */
export const GENERAL_SAFE = new Set([
  'status', 'sessions', 'branches', 'jobs', 'version', 'doctor', 'logs',
  'stop', 'help', 'menu', 'prices', 'thoughts',
]);

/** Canonical immediate command name for a message, or '' when it must queue. */
export function immediateCommandOf(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed.startsWith('/')) return '';
  const [head, ...rest] = trimmed.split(/\s+/);
  const collapsed = commandOf(head).replace(/^\//, '');
  return immediateKind(collapsed, rest);
}

/**
 * Language for a chat and topic.
 *
 * Extracting the formatting helpers into `format.mjs` took this function with
 * them, and the two `langFor` call sites stayed behind — so `send()` threw
 * `langFor is not defined` on its first line and the restart notice never
 * reached the chat. Nothing caught it: the error was logged and swallowed by
 * the outer `try`, and the process kept running. It is a one-line wrapper, and
 * the tests below pin the call sites so a missing name fails there instead.
 */
export function langFor(chatId, threadId = 0) {
  return resolveLang(state, sessionKey(chatId, threadId), null, config);
}

/**
 * Where a release notice goes: the last chat a turn ran in.
 *
 * `state.sessions[key]` is a session id, not a record, so the order is by last
 * use — the bridge records it in `state.lastKey` whenever it starts a turn. With
 * no session at all (a fresh install that never talked) a notice is pointless,
 * and nothing is sent.
 */
export function lastTurnTarget() {
  const key = typeof state.lastKey === 'string' ? state.lastKey : '';
  const [chat, thread] = key.split(':');
  const chatId = Number(chat);
  if (!Number.isInteger(chatId) || chatId <= 0) return null;
  return { chatId, threadId: Number(thread) || 0 };
}
