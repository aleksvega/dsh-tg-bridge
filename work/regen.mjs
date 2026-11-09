// Regenerate the last answer: the desktop's most-used button, one tap here.
//
// A retry that matters is two moves in one — the finished exchange must leave
// the session (a copy of it must not sit above the same question asked again),
// and the question itself is fed back as a fresh message. `/regen` is the one
// implementation of that; the ↻ button on a turn's final card only checks that
// the card still describes the last turn, then types the command.
import { recentTurns } from './rewind.mjs';

/** Callback data the ↻ button carries: `rg:<turn>:<last 8 of session id>`. */
export const REGEN_CALLBACK = /^rg:(\d{1,6}):([0-9a-f]{8})$/;

export function isRegenPress(data) {
  return String(data || '').startsWith('rg:');
}

/**
 * Whether a press still describes the last turn of the topic's session.
 *
 * Everything is re-read at press time: the tail catches a topic that moved to
 * another session (branched, switched, fresh), and the turn number catches the
 * one case a number-less button would get wrong — an older card of the same
 * session, which would otherwise cut the CURRENT last turn while the person
 * asked to redo the one the card was drawn for. Both answer `stale`.
 *
 * @returns {{ verdict: 'ok', turn: number, user: string } | { verdict: 'busy' | 'stale' }}
 */
export function regenPressState(data, { sessionId = '', busy = false, file = '' } = {}) {
  const match = REGEN_CALLBACK.exec(String(data || ''));
  if (!match) return { verdict: 'stale' };
  const [, turn, tail] = match;
  if (!sessionId || !sessionId.endsWith(tail)) return { verdict: 'stale' };
  if (busy) return { verdict: 'busy' };
  const last = recentTurns(file, { limit: 1 })[0];
  if (!last || Number(turn) !== last.turn) return { verdict: 'stale' };
  return { verdict: 'ok', turn: last.turn, user: String(last.user || '') };
}

/**
 * The ↻ row for a finished turn's card, first row above any file buttons.
 *
 * The turn number is read from the session at card time, so the button names
 * the turn the card belongs to; a session that cannot be read gets no button —
 * a ↻ that guesses would cut a turn it never saw.
 */
export function regenRow(sessionId, file, lang, t) {
  if (!sessionId || !file) return [];
  const last = recentTurns(file, { limit: 1 })[0];
  if (!last) return [];
  return [{
    text: `↻ ${t(lang, 'btn.regen')}`.slice(0, 64),
    callback_data: `rg:${last.turn}:${sessionId.slice(-8)}`,
  }];
}
