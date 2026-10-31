# Tasks — the turn card and the subagent panel

## 0. The numbers, once

- [ ] 0.1 One collector turns a finished turn into a record: wall time, tokens,
  tokens per second, cache hit, cost when the provider reports it, and the balance
  when the endpoint answers for it.
  A value the provider did not report is `null`, never `0` — the difference is the
  whole point of the card.
- [ ] 0.2 `test/turn-card.test.mjs`: every block renders in `en`, `ru` and `zh`,
  and a `null` renders as the unknown sentence rather than as a zero.

## 1. The card

- [ ] 1.1 `control/turn-card.mjs`: blocks as rows, selected per topic, stored in
  `state` and read back on the next turn.
- [ ] 1.2 One router, its own tests, and every press acknowledged on the path a
  real tap takes — the `/model` lesson, applied before the bug this time.
- [ ] 1.3 The card is sent as its own message, so the answer stays readable and a
  failed card cannot take the answer with it.

## 2. The panel

- [ ] 2.1 `turn/panel.mjs`: one row per subagent — the task, elapsed, tokens when
  known — edited in place.
- [ ] 2.2 A throttle window of at least two seconds, and no edit when nothing
  visible changed. The throttle is the feature: a fast turn otherwise edits once
  per event and hits a rate limit.
- [ ] 2.3 A failed edit is one log line and never fails the turn.
- [ ] 2.4 The panel disappears or becomes the card when the turn ends, including
  when it fails: a row that still looks alive after the turn is worse than none.
- [ ] 2.5 `test/subagent-panel.test.mjs` with a synthetic event stream: one row per
  subagent, one edit per window, nothing left behind.

## 3. Acceptance

- [ ] 3.1 Suite green, no new dependency, no module over 500 lines.
- [ ] 3.2 Measured on the live bot: a turn with two subagents, a turn with none,
  and a turn that fails — the panel and the card each observed.
- [ ] 3.3 Three locales in the same commit.
- [ ] 3.4 CHANGELOG names both surfaces and the throttle.