// What the chat knows about the subagents a turn spawned.
//
// The desktop app lists them with who they were, how long they ran and how many
// tokens they burned. The headless host reports a subagent as a tool call and,
// later, a result: no name, no tokens, no live progress. So a run is exactly
// three facts — the task it was given, the gap between the call and its result,
// and whether that result was an error. Tokens are deliberately absent: the only
// number the host reports is the whole turn's, and splitting it across subagents
// would be a guess printed as a measurement.
//
// Kept in the topic's state rather than in the session file: sessions are zstd
// frames the bridge only ever cuts at turn boundaries, and reading one back just
// to list four rows would cost more than the rows are worth.

/** How many runs a topic remembers. Older ones are dropped, not hidden. */
export const RUNS_KEEP = 24;

/** A run as it is stored: short, comparable, and free of anything a card can trip on. */
function normalise(run) {
  return {
    tool: String(run?.tool || 'subagent').slice(0, 40),
    label: String(run?.label || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    ms: Number.isFinite(run?.ms) ? Math.max(0, Math.round(run.ms)) : null,
    failed: Boolean(run?.failed),
  };
}

/**
 * Add this turn's runs to the topic's history, newest last.
 * Returns the history as it now stands, so the caller can log or draw it.
 */
export function rememberRuns(state, key, runs) {
  const fresh = (Array.isArray(runs) ? runs : []).filter(Boolean).map(normalise);
  if (!fresh.length) return runsOf(state, key);
  if (!state || !key) return fresh;
  state.subagents ??= {};
  const kept = [...(state.subagents[key] || []), ...fresh].slice(-RUNS_KEEP);
  state.subagents[key] = kept;
  return kept.slice();
}

/** The runs this topic remembers, oldest first. Never the stored array itself. */
export function runsOf(state, key) {
  const kept = state?.subagents?.[key];
  return Array.isArray(kept) ? kept.map((run) => ({ ...run })) : [];
}

/** Forget this topic's history. Returns how many runs were dropped. */
export function forgetRuns(state, key) {
  const kept = runsOf(state, key);
  if (state?.subagents && key) delete state.subagents[key];
  return kept.length;
}

/**
 * The totals a card prints: how many ran, how long they took together, how many
 * failed, and how many never reported a result before the turn ended.
 */
export function runsSummary(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const finished = list.filter((run) => Number.isFinite(run?.ms));
  return {
    count: list.length,
    failed: list.filter((run) => run?.failed).length,
    ms: finished.reduce((sum, run) => sum + run.ms, 0),
    unfinished: list.length - finished.length,
  };
}
