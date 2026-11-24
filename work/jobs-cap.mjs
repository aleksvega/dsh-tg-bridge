// The parallel-turn ceiling: one rule, two ways in.
//
// `/jobs 5` and the buttons under the `/jobs` card write the same number, and a
// tap must not be able to store a value the command would refuse. The ceiling is
// a real machine limit — every parallel turn is a whole DSH process — so the
// range stops at twelve and the refusal says why instead of clamping.
//
// Twelve is a ceiling, not a target: a turn costs a few hundred megabytes, so on
// a 16 GB machine half a dozen heavy turns is already the comfortable number and
// the rest wait for a slot (announced, see `enqueue`). The card says so.
//
// The live config changes first and is persisted second: a failed write costs
// the setting after a restart, not the setting now, and the caller reports which
// of the two happened rather than claiming a save it did not make.
export const CAP_MIN = 1;
export const CAP_MAX = 12;

/** The values the card offers. Twelve is reachable without a wall of buttons. */
export const CAP_CHOICES = [1, 2, 3, 4, 6, 8, 10, 12];

/**
 * Apply a ceiling. Returns `{ ok:false }` for anything outside the range, and
 * `{ ok:true, n, saved }` otherwise, with `saved` false when config.json could
 * not be written.
 */
export function setParallel(value, { config, saveConfig, log }) {
  const n = Number(String(value).trim());
  if (!Number.isInteger(n) || n < CAP_MIN || n > CAP_MAX) return { ok: false };
  config.maxParallel = n;
  const saved = Boolean(saveConfig && saveConfig());
  if (log) log(`maxParallel set to ${n}${saved ? '' : ' (config.json write failed)'}`);
  return { ok: true, n, saved };
}
