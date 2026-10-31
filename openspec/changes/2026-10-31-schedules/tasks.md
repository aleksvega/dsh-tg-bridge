# Tasks — daily schedules

## 0. The clock, without a calendar engine

- [x] 0.1 `work/schedules.mjs`: `parseEvery` refuses a relative delay, an
  impossible clock and a missing text; `nextClock` turns a wall clock into the
  next local occurrence.
  → 108 lines. It reuses `work/reminders.mjs`'s `nextClock` rather than carrying a
  second clock.
- [x] 0.2 `claimRows(due, now)` advances `at` and returns the rows to deliver, so
  the caller persists before it sends.
- [x] 0.3 `test/every.test.mjs`: clock, refusal and claim, by table.

## 1. The command

- [x] 1.1 `control/cmd-every.mjs`: `/every <HH:MM> <text>`, `/every list`,
  `/every rm <n>`, and the bare usage line.
- [x] 1.2 Register `every` in the control registry, the `/help` page and the
  `Tuning` group, so it is discoverable without being typed.
- [x] 1.3 The cap: twenty per chat, refusal names the number.
- [x] 1.4 `i18n/{en,ru,zh}/every.mjs`: thirteen strings in their own table,
  because they pushed `ctrl.mjs` past the ceiling.

## 2. The tick

- [x] 2.1 `turn/job-loops.mjs`: `runScheduleTick(now, deps)` on a 20 s unref'd
  interval, each row under its own `try/catch`.
- [x] 2.2 A due row becomes a synthetic message for its own chat and topic and
  goes through `redeliver`; the tick never calls `send()`.
- [x] 2.3 A deleted topic is one log line and the row still advances.
- [x] 2.4 Restart catch-up: a row four days past due fires once.
- [x] 2.5 Double-fire: a claimed row is not redelivered after a restart.

## 3. Acceptance

- [x] 3.1 Suite green with the change in the tree (751 tests).
- [x] 3.2 Three locales, no raw key in any answer.
- [ ] 3.3 State the limit in the help page: a schedule fires only while the bridge
  runs, and a missed one fires once on the next start. The CHANGELOG says it; the
  `/help every` page does not yet.
- [ ] 3.4 A test that the tick does not run twice for one row when two ticks
  overlap (the claim is synchronous, the delivery is not). Today the claim is
  asserted, the overlap is not.
- [ ] 3.5 Release 1.37.0 with the CHANGELOG entry already written.