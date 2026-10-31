# Tasks — the acceptance bar

## 0. The command

- [x] 0.1 Name the one command the bar is measured by.
  → `Remove-Item Env:DSH_HOME` then `node --test test/*.test.mjs` from the
  repository root. 751 tests, 12 s, no network.
- [ ] 0.2 Write the same command into `docs/` where a new contributor looks first,
  next to the run instructions.
  The gate is judged by review: no test can assert that a human ran the whole
  suite.

## 1. A fix carries its failing-on-the-old-revision test

- [x] 1.1 The card router: `modelPressRouter` is driven by a test with a stubbed
  transport, and removing the `t` import makes that one test fail.
  → `test/model-picker.test.mjs`, "the router a real tap goes through can
  translate, redraw and claim". Verified by deleting the import and observing
  exactly one failure.
- [x] 1.2 The dropped heading: a test asserts every button the card draws
  survives `inlineKeyboard`, and another asserts no two route labels collide.
- [ ] 1.3 Extend `test/unresolved-calls.test.mjs` so a bare shorthand reference
  (`{ t }`) to an exported name is checked too, not only a call (`t(`).
  It is the guard that should have caught 1.1 and cannot: its `visibleNames()` is
  file-wide, so a parameter of any function counts as visible module-wide.
  Needs scope tracking, so it is its own change.

## 2. Three locales

- [x] 2.1 Parity is enforced by the i18n test.
- [ ] 2.2 Add a test that every key has a consumer, so a removed control cannot
  leave its words behind. Today the dead `ctrl.model.pickGroup` was removed by
  hand.

## 3. A claim is measured

- [x] 3.1 Record the measurement next to the claim: the cut-stream family names
  the live error, the turn length and the tool count in its own comment.
- [ ] 3.2 Add the observed status and latency to any future provider claim.

## 4. Publish

- [ ] 4.1 After the spec is archived, move `quality-bar` into
  `openspec/specs/quality-bar/spec.md` and reference it from `CONTRIBUTING`.
- [ ] 4.2 CHANGELOG line names the two defects the bar was written after.