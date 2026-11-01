// What the chat sends when the model hands back its own notes instead of a reply.
//
// The headless CLI's `final` text is the turn's last assistant text, and a turn
// that produced no answer reports the reasoning. Forwarding it reads as "the bot
// answers with its thinking", and suppressing it reads as "the turn died" — both
// were real, and both are the same defect seen from two sides. The guard here
// asks once more, in the same session, for a finished reply; only when that also
// comes back as notes does it send the honest sentence.
//
// Extracted from `handle-message.mjs`, which is at its size ceiling and whose
// subject is "one incoming message becomes one turn", not "what a reply is".
import { looksLikeReasoning, REPLY_NUDGE, stripThinkingBlocks } from './panel.mjs';
import { turnAttempt } from '../turn/turn.mjs';

/** Is this text the reasoning the panel already holds, markers included? */
export function isReasoningEcho(value, reasoning) {
  return looksLikeReasoning(value, reasoning);
}

/**
 * Produce the text the chat should send, asking the model once more if needed.
 *
 * @param {object} input
 * @param {object} input.result the finished turn: `{ text, error }`, replaced in
 *   place when the second attempt produces a real answer
 * @param {() => string} input.reasoning the reasoning this turn collected
 * @param {string} input.key the topic key
 * @param {object} input.turnOptions the options the first attempt ran with, so
 *   the second attempt cannot drift from it
 * @param {string} input.sessionId the session the first attempt ran in
 * @param {string} input.where the log label for this topic
 * @param {(line: string) => void} input.log
 * @param {Function} [input.retryTurn] builds the second attempt; defaults to the
 *   real one. Injectable because the guard's tests must not spawn a CLI.
 * @returns {Promise<{ text: string, echoed: boolean }>} `echoed` means nothing
 *   the person should read was produced, and the caller sends its own sentence
 */
export async function replyText({ result, reasoning, key, turnOptions, sessionId, where, log, retryTurn = turnAttempt }) {
  const echoed = (value) => isReasoningEcho(value, reasoning());
  if (echoed(result.text)) {
    log(`reasoning echo for ${where} (${String(result.text).length} chars) — asking once more`);
    const retry = await retryTurn(REPLY_NUDGE, key, turnOptions)(sessionId);
    if (!retry.error && !echoed(retry.text) && stripThinkingBlocks(retry.text)) {
      Object.assign(result, retry);
    }
  }
  if (echoed(result.text)) {
    log(`reasoning echo suppressed for ${where} (${String(result.text).length} chars)`);
    return { text: '', echoed: true };
  }
  // The marker can survive inside an otherwise real reply; the chat never shows it.
  return { text: stripThinkingBlocks(result.text), echoed: false };
}

export { REPLY_NUDGE };
