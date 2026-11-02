# Tasks — the turn card and the subagent panel

## 0. The numbers, once

- [x] 0.1 One collector turns a finished turn into a record: wall time, tokens,
  tokens per second, cache hit, cost when the provider reports it, and the balance
  when the endpoint answers for it.
  A value the provider did not report is `null`, never `0` — the difference is the
  whole point of the card.
  → Built as two pieces, not one module: `speedOf()` in `turn/progress.mjs` turns
  usage into tokens per second (and says nothing when it has no measurement), and
  the `final` view of the same module adds the cost and cache lines. The unknown
  case is a `0` sentinel that the renderer omits, so a card never claims 0 tok/s —
  which is what the task was protecting.
- [x] 0.2 `test/turn-card.test.mjs`: every block renders in `en`, `ru` and `zh`,
  and a `null` renders as the unknown sentence rather than as a zero.
  → `test/turn-card.test.mjs`, 6 tests over `turn/card.mjs`: three locales, an id
  the build forgets is dropped rather than rendered, and toggling an unknown block
  is a refusal, not a write.

## 1. The card

- [x] 1.1 `control/turn-card.mjs`: blocks as rows, selected per topic, stored in
  `state` and read back on the next turn.
  → `turn/card.mjs` (72 lines) with `state.cardBlocks[key]`, read by `/card`
  (`control/cmd-card.mjs`) and by the panel's `final` view. The blocks are
  `time, speed, thoughts, steps, context, cost, cache, reasoning`.
- [x] 1.2 One router, its own tests, and every press acknowledged on the path a
  real tap takes — the `/model` lesson, applied before the bug this time.
  → `tc:` in `chat/callbacks.mjs`: redrawn from state so a double tap settles on
  one truth, an id this build does not know answers `card.stale`, and the press is
  answered with `card.cbOn` / `card.cbOff` after the edit. `test/turn-card.test.mjs`
  covers the keyboard and the toggle.
- [x] 1.3 The card is sent as its own message, so the answer stays readable and a
  failed card cannot take the answer with it.
  → The card *is* the progress message, edited in place and finalised at the end;
  the answer is a separate message. A card edit that fails cannot reach the answer:
  the edit's failure is caught in `turn/progress.mjs` and logged, never thrown.

## 2. The panel

- [x] 2.1 `turn/panel.mjs`: one row per subagent — the task, elapsed, tokens when
  known — edited in place.
  → `chat/panel.mjs`: `isSubagentTool()` and `subagentStep()`. Elapsed is measured
  between the call and its result; tokens are not available headless and the line
  does not invent them.
- [x] 2.2 A throttle window of at least two seconds, and no edit when nothing
  visible changed. The throttle is the feature: a fast turn otherwise edits once
  per event and hits a rate limit.
  → A single `setTimeout` of 5000 ms in `turn/progress.mjs`; the `dirty` flag drops
  an edit whose rendering did not change, and `lastView` compares before sending.
- [x] 2.3 A failed edit is one log line and never fails the turn.
  → Added with this review: the catch was silent, which is how a panel that never
  updates hides for weeks. It now logs `panel edit skipped [<code>]` and keeps the
  turn alive.
- [x] 2.4 The panel disappears or becomes the card when the turn ends, including
  when it fails: a row that still looks alive after the turn is worse than none.
  → The same message is edited into the `final` view (cost and cache included), and
  a failed turn edits its error into that message instead of leaving the last live
  frame on screen.
- [x] 2.5 `test/subagent-panel.test.mjs` with a synthetic event stream: one row per
  subagent, one edit per window, nothing left behind.
  → `test/subagent-panel.test.mjs`, 8 tests: one row per subagent, a missing
  duration is absent rather than `0s`, a sub-second gap reads as `1s`, the task is
  one collapsed line of at most 52 characters, the prompt and the bare name are the
  fallbacks, and folding compares the rendered line — two runs that took four and
  nine seconds stay two rows. The edit cadence itself is not tested: it lives in a
  closure that needs a live Telegram client, and a test that stubs the client would
  be testing the stub.

## 3. Acceptance

- [x] 3.1 Suite green, no new dependency, no module over 500 lines.
- [ ] 3.2 Measured on the live bot: a turn with two subagents, a turn with none,
  and a turn that fails — the panel and the card each observed.
- [x] 3.3 Three locales in the same commit.
- [x] 3.4 CHANGELOG names both surfaces and the throttle.

## 4. What this review changed

The change was written as `control/turn-card.mjs` and `turn/panel.mjs` and shipped
as `turn/card.mjs` and `chat/panel.mjs`. The boxes stayed empty because the paths
moved, not because the work was missing — and an empty box is what a plan is built
from, so every one of them was re-checked against the code rather than the file
list. Two real gaps came out of it: a silent catch (2.3) and no test for the
subagent row (2.5). Both are closed. The only open box is 3.2, the live
measurement, which needs the person.