# Tasks — the acceptance bar

## 0. The command

- [x] 0.1 Name the one command the bar is measured by.
  → `Remove-Item Env:DSH_HOME` then `node --test test/*.test.mjs` from the
  repository root. 751 tests, 12 s, no network.
- [x] 0.2 Write the same command into `docs/` where a new contributor looks first,
  next to the run instructions.
  The gate is judged by review: no test can assert that a human ran the whole
  suite.
  → `docs/DEV-LOOP.md` already had it at line 37, `DSH_HOME` unset and all.

## 1. A fix carries its failing-on-the-old-revision test

- [x] 1.1 The card router: `modelPressRouter` is driven by a test with a stubbed
  transport, and removing the `t` import makes that one test fail.
  → `test/model-picker.test.mjs`, "the router a real tap goes through can
  translate, redraw and claim". Verified by deleting the import and observing
  exactly one failure.
- [x] 1.2 The dropped heading: a test asserts every button the card draws
  survives `inlineKeyboard`, and another asserts no two route labels collide.
- [x] 1.3 Extend `test/unresolved-calls.test.mjs` so a bare shorthand reference
  (`{ t }`) to an exported name is checked too, not only a call (`t(`).
  It is the guard that should have caught 1.1 and cannot: its `visibleNames()` is
  file-wide, so a parameter of any function counts as visible module-wide.
  Needs scope tracking, so it is its own change.
  → Rewritten around `missingRefs(code, exported)`: module-level names are imports
  and top-level declarations, and a parameter only counts inside its own body
  (destructured `{ t }` signatures included, expression-bodied arrows included).
  Four fixtures pin the scoping — a neighbour's parameter does not leak, a
  shorthand property is checked like a call, a destructured parameter binds, an
  import is visible file-wide — and the tree-wide test was proved non-vacuous by
  adding one unbound `t(` to `core/paths.mjs` and watching it fail with the line
  number.
  The per-file list of every exported name is still the candidate set, so a typo
  in a name the bot never exported from anywhere is out of scope.

## 2. Three locales

- [x] 2.1 Parity is enforced by the i18n test.
- [x] 2.2 Add a test that every key has a consumer, so a removed control cannot
  leave its words behind. Today the dead `ctrl.model.pickGroup` was removed by
  hand.
  → The rule needed no hand list after all. A key is consumed if the shipped code
  mentions it literally or builds it from a prefix it spells out — `settings.${row}.label`
  and `'ctrl.cmd.' + name` both count — so `test/i18n-consumers.test.mjs` checks
  reachability mechanically and needs a written reason for an exemption.
  It found thirty keys in all three languages: the `/model` grouping step, the
  whole `ctrl.cmd.*` command-card family, `btn.stop`, `btn.logs`, `err.timeout`,
  `err.generic`, `msg.stateOn`, `msg.stateOff`, `cmd.help.title`, `cmd.help.hint`,
  `goal.default`, `ctrl.ls.usage`, `ctrl.settings.opened`, `ctrl.model.usage`,
  `ctrl.plugin.updateNone`, `ctrl.version.backup`, `ctrl.update.available`,
  `ctrl.model.pickSwitched`, `ctrl.dsh.appCli`, `ctrl.dsh.npmCli`. Ninety strings
  deleted; nothing referenced them, and the suite stayed green.
  Proved non-vacuous by adding one unreachable key and watching it fail by name.

## 3. A claim is measured

- [x] 3.1 Record the measurement next to the claim: the cut-stream family names
  the live error, the turn length and the tool count in its own comment.
- [ ] 3.2 Add the observed status and latency to any future provider claim.

## 4. Publish

- [ ] 4.1 After the spec is archived, move `quality-bar` into
  `openspec/specs/quality-bar/spec.md` and reference it from `CONTRIBUTING`.
- [ ] 4.2 CHANGELOG line names the two defects the bar was written after.