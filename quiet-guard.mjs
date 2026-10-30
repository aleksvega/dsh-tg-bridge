// A press or a command that hangs must not be silence.
//
// Two things go wrong with a button. The handler throws, and Telegram keeps the
// spinner turning until the client gives up; or the handler waits on something
// that never answers, and the wait has no end. On the phone both look the same —
// nothing happens — and the person presses again, which starts the second copy
// of the same hang. The log cannot say which of the two it was, because a press
// that produced nothing never wrote a line either.
//
// This module makes the silence itself an event. Whatever handles the press
// reports its first visible output through `wrap`/`mark`; if nothing is reported
// inside the window, `onSlow` runs once. The timer is not cancelled when the
// handler returns, because a handler that returned without saying anything is
// exactly the case this exists for: the notice still arrives, one window later,
// and says so.
//
// `onSlow` is best effort by contract: a notifier that throws must not become a
// second failure, so its error is swallowed here and the caller's own error path
// stays the one that reports.
export const QUIET_MS = 45_000;

export function quietGuard({ ms = QUIET_MS, onSlow, now = () => Date.now() } = {}) {
  const started = now();
  let spoke = false;
  let fired = false;
  const timer = setTimeout(() => {
    if (spoke || fired) return;
    fired = true;
    try {
      onSlow?.(now() - started);
    } catch {
      /* the notice is best effort */
    }
  }, ms);
  // A watchdog must never be the reason a process stays alive.
  timer.unref?.();
  return {
    /** Wrap an output function: calling it counts as answering. */
    wrap(fn) {
      return (...args) => {
        spoke = true;
        return fn(...args);
      };
    },
    /** Count an output that was sent some other way. */
    mark() {
      spoke = true;
    },
    spoke: () => spoke,
    firing: () => fired,
    /** Stop the timer. The notice is not sent — for tests and for shutdown. */
    cancel() {
      clearTimeout(timer);
    },
  };
}
