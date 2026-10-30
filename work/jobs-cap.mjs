// The parallel-turn ceiling: one rule, two ways in.
//
// `/jobs 5` and the buttons under the `/jobs` card write the same number, and a
// tap must not be able to store a value the command would refuse. The ceiling is
// a real machine limit — every parallel turn is a whole DSH process — so the
// range is closed at eight and the refusal says why instead of clamping.
//
// The live config changes first and is persisted second: a failed write costs
// the setting after a restart, not the setting now, and the caller reports which
// of the two happened rather than claiming a save it did not make.
export const CAP_MIN = 1;
export const CAP_MAX = 8;

/** The values the card offers. Five rows of buttons is already a lot of thumb. */
export const CAP_CHOICES = [1, 2, 3, 4, 5, 8];

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
