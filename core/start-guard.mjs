// The gap between "a tick spawned a bridge" and "the bridge is visible".
//
// The tick holds an exclusive lock so that two ticks one minute apart cannot both
// start a poller — two bridges on one token is a 409 storm. But the lock used to
// be released when the tick exited, which is *before* the child writes
// `bridge.pid`: a second tick landing in that gap saw an empty directory, no
// lock, and started a second bridge. Holding the lock until the pid file exists
// closes the gap; this module is the waiting half, kept separate so the wait can
// be tested without spawning anything.
//
// The wait never fails the tick. A bridge that boots slowly will write its pid
// after the deadline, and the next tick finds it; the point is only to cover the
// seconds where two ticks could overlap.

/** Poll interval: long enough to be cheap, short enough not to add a second. */
const STEP_MS = 100;

/**
 * Wait until `readPid()` names a live process, at most `limit` ms.
 *
 * Returns true when a pid appeared, false when the child died (it will never
 * write one) or the deadline passed. `sleep` and `now` are injectable so a test
 * can run the whole deadline in microseconds.
 */
export async function awaitPid({
  readPid,
  isAlive,
  childPid = 0,
  limit = 8_000,
  step = STEP_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
} = {}) {
  const deadline = now() + limit;
  for (;;) {
    const onDisk = Number(readPid()) || 0;
    if (onDisk && isAlive(onDisk)) return true;
    // The child is gone: no pid file is coming, and the crash counter has the
    // start recorded already, so there is nothing left to learn by waiting.
    if (childPid && !isAlive(childPid)) return false;
    if (now() >= deadline) return false;
    await sleep(step);
  }
}