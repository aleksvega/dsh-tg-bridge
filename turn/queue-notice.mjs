// When is a "your message is queued" notice already obsolete?
//
// It was written for a specific running turn (`turnWhenQueued`). It must go as
// soon as that turn is no longer the one in front: either the queue drained, or
// the queued turn started (its start time differs). Kept in its own module so
// the rule can be tested without starting the bridge or talking to Telegram.

export function noticeIsObsolete(turnWhenQueued, turnNow, stillQueued) {
  return !stillQueued || turnNow !== turnWhenQueued;
}
