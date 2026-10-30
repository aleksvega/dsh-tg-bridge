// What the bridge does with each event a turn emits.
//
// The turn runner streams a line-oriented JSON event per step: `session`,
// `tool_call`, `tool_result`, `status`, `text`, `thinking`, `final`. Four
// consumers want a piece of that stream — the progress card, the log, the
// telemetry summary, and the sandbox-refusal watcher — and they used to be four
// branches inside `handle-message.mjs`, a file that sits at its size ceiling and
// grew a line for every new event type.
//
// This module is the one place that knows the event vocabulary. Everything in it
// is wrapped so a malformed event can never take down a turn: the stream is the
// provider's, and a bridge that dies on an unexpected field is worse than one
// that logs nothing about it.
import { stepLine } from './panel.mjs';

/**
 * The counters the turn summary in the log is built from.
 *
 * `/logs` shows "in" and "sent" and nothing else without these, which makes
 * "why did this take nine minutes" unanswerable after the fact.
 */
export function newTelemetry(model = '') {
  return {
    steps: 0,
    tools: 0,
    toolNames: [],
    inputTokens: 0,
    cacheReadTokens: 0,
    // Passed in rather than looked up here: the profile of a topic lives in the
    // state file and its model in a patch file, and a module that counts tool
    // calls has no business reading either.
    model,
    // Set by the fallback chain when a route other than the topic's own answered.
    // The model field alone cannot say that: it is also the configured model.
    switched: false,
  };
}

/**
 * Remember who answered, per topic, for `/model` and the settings card.
 *
 * Both cards name the route the topic is *configured* with. After a fallback
 * that is not the route that replied, and the difference is the one thing a
 * person checking "why is this slow/vague" needs to see. Kept here because the
 * telemetry is what knows, and the message handler is at its size ceiling.
 */
export function noteAnswered(state, key, telemetry = {}) {
  state.answered = state.answered || {};
  state.answered[key] = {
    model: telemetry.model || '',
    switched: Boolean(telemetry.switched),
    at: Date.now(),
  };
}

/**
 * Build the event handler for one turn.
 *
 * @param {object} input
 * @param {{handle: (event: object) => void}} input.progress the progress card
 * @param {object} input.telemetry from `newTelemetry`, mutated in place
 * @param {Array} input.refusals failed tool results, appended for `sandbox-note`
 * @param {(line: string) => void} input.log
 * @param {(sessionId: string) => void} [input.onSession] learns the live session id
 * @returns {(event: object) => void}
 */
export function makeTurnEvents({ progress, telemetry, refusals, log, onSession }) {
  return (event) => {
    try {
      // The id of the session this process actually works in. A new topic has no
      // id until the CLI emits one, and steering needs it before that.
      if (event.type === 'session' && event.sessionId && onSession) onSession(event.sessionId);
      progress.handle(event);
      if (event.type === 'tool_call') {
        telemetry.tools += 1;
        telemetry.steps += 1;
        if (event.tool && telemetry.toolNames.length < 40) telemetry.toolNames.push(String(event.tool));
        log(`  tool[${telemetry.steps}] ${(stepLine(event) || event.tool || 'tool').slice(0, 140)}`);
      } else if (event.type === 'tool_result') {
        const failed = event.status && event.status !== 'completed';
        log(`  tool[${telemetry.steps}] ${failed ? 'ERROR' : 'ok'} ${String(event.tool || '').slice(0, 40)}`);
        // A sandbox refusal is a decision, not a crash: it is collected here and
        // explained once at the end, instead of looking like a broken turn.
        if (failed) refusals.push({ tool: event.tool, result: event.result });
      } else if (event.type === 'status' && event.usage) {
        if (Number.isFinite(event.usage.inputTokens)) telemetry.inputTokens = event.usage.inputTokens;
        if (Number.isFinite(event.usage.cacheReadTokens)) telemetry.cacheReadTokens = event.usage.cacheReadTokens;
      }
    } catch {
      // One unreadable event must not end the turn: the rest of the stream is
      // still worth reading, and the card simply misses one step.
    }
  };
}
