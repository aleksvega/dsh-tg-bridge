# A daily schedule that fires as a real turn

## Why

A person who wants the same text run every morning at nine has one option
today: send it by hand, or write a cron entry that calls the CLI behind the
bridge's back. The second is worse than it sounds — the CLI has no idea which
topic the work belongs to, so the answer lands nowhere the person is reading, and
the session it uses is not the one the topic already has.

The bridge already knows the two things a schedule needs: which chat and topic a
row belongs to, and how to hand a message to the same turn path an incoming
message takes. A calendar engine is the only thing it was missing, and it does
not need one: a daily wall clock is an interval and a comparison.

## What changes

1. **`/every 09:00 text` creates one daily schedule for the current topic.**
   `/every list` numbers this chat's schedules with their next run and their
   text; `/every rm 2` removes one by that number; a bare `/every` answers with
   the usage line.
2. **A firing is a turn, not a notification.** The tick builds a synthetic
   message for the row's own chat and topic and hands it to the same `redeliver`
   path an incoming message takes, so the agent reads the text and does the work.
   The firing path never calls `send()` itself.
3. **Nothing fires twice, and a missed occurrence fires once.** The tick claims a
   due row by moving its time to the next occurrence and saving *before*
   delivery, so a restart replays nothing it already claimed and a bridge that
   was down fires the missed occurrence exactly once.
4. **The next occurrence comes from the wall clock, not from `+24h`**, so a
   schedule follows the clock across a daylight-saving change instead of drifting
   an hour.
5. **The parser is the reminder's parser.** `parseEvery` refuses `+15m`, `25:00`
   and a missing text with the same words `/remind` uses, because two spellings
   of one rule is how a person learns the wrong one.

## Non-goals

- No cron syntax, no `*/5`, no monthly or weekly rules. A wall clock and a text
  is the whole feature; anything more is a different one with its own editor.
- No new dependency and no daemon: the tick is an interval inside the process the
  bridge already runs.
- No per-schedule route or profile. A firing runs as the topic runs, so the
  topic's own `/model` and `/permissions` keep working without a second setting.

## Definition of done

1. `test/every.test.mjs` covers the parser, the claim, a restart catch-up, a
   double-fire, the twenty-schedule cap, the three locales and a topic that no
   longer exists.
2. A schedule that came due while the bridge was stopped fires once on the next
   start, asserted by moving a stored time into the past and starting the tick.
3. `/every` is a control command with a `/help every` page and a `Tuning` entry,
   and every string exists in `en`, `ru` and `zh`.
4. CHANGELOG names the one limit plainly: a schedule fires only while the bridge
   runs.

## Impact

- **Users**: one more command; nothing existing changes behaviour.
- **Maintainer**: one more tick inside a process that already runs, one file of
  clock arithmetic, and a cap that is a number in one place.
- **Risk**: a tick that throws takes the bridge's loop with it, so every row is
  dispatched under its own `try/catch` and a failure is one log line rather than
  a retry every twenty seconds.