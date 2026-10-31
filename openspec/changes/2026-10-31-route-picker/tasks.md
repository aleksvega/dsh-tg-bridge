# Tasks — the route picker and the chain

## 0. The card's buttons

- [x] 0.1 `control/model-card.mjs` imports the translator its router passes in.
  → The router is the only caller that supplies `t`; the import it referenced was
  missing from 1.32.0 to 1.37.1, so every tap threw.
- [x] 0.2 The provider travels on the button: `provider · model`, and no heading
  rows, because the keyboard conversion deletes them.
- [x] 0.3 `test/model-picker.test.mjs` drives `modelPressRouter` with a stubbed
  `fetch`, asserting the press is claimed, redrawn, acknowledged and logged.
  → Removing the import fails exactly this test.
- [x] 0.4 No two route labels collide; every drawn button survives
  `inlineKeyboard`.
- [x] 0.5 `ctrl.model.pickGroup` removed from `en`, `ru` and `zh`: the row it
  named no longer exists.
- [x] 0.6 The card is two steps: endpoints with their route counts and a tick,
  then that endpoint's models with the endpoint in the header and a back row.
  Chosen in `md:!p:<endpoint>`; the model press keeps the existing
  `md:<endpoint>:<model>` form, so a route is still named in full and never by
  index.
- [x] 0.7 The scope toggle and refresh carry the step, so neither sends a person
  who is choosing a model back to the endpoint list.
- [x] 0.8 A stale endpoint is refused and the list redrawn as it is now, the same
  rule the stale route press already followed.
- [x] 0.9 `test/model-picker.test.mjs` covers the two steps: open, back, the scope
  toggle keeping its step, a refresh keeping its step, and a vanished endpoint.

## 1. The chain's classification

- [x] 1.1 `model/fallback.mjs`: `STREAM_CUT` and the `stream` family, with
  `STREAM_BUDGET = 1`.
- [x] 1.2 `bridge.fallback.stream` in `en`, `ru` and `zh`, and the trigger list on
  the `/fallback` card names a cut stream.
- [x] 1.3 `test/fallback-chain.test.mjs` asserts the live truncated-stream string
  is `stream`, that it triggers the chain, and that the budget is one.

## 2. Acceptance

- [x] 2.1 Suite green (751 tests) with both fixes in the tree.
- [x] 2.2 The card renders five endpoints and eight unorouter models on the live
  profile, checked by rendering it, not by review.
- [ ] 2.3 Extend the `unresolved-calls` guard to shorthand references, so the
  missing-import class is caught by governance rather than by a card's own test.
  Belongs to the acceptance-bar change; tracked there.
- [ ] 2.4 Release 1.37.1 with the CHANGELOG entry already written.