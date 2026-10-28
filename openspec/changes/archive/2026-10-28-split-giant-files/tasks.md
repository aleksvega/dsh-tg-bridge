# Tasks — split every giant into modules under 500 lines

Every box was ticked by a commit on `refactor/split-giant-files`; the brackets
are the record, not a promise. Line counts are physical lines of the file.

## 1. The rule, enforced before anything moved

- [x] 1.1 `test/module-size.test.mjs`: 500 lines, `files[]` as the definition of
  "shipped", a `MIGRATION` set that only shrinks.
- [x] 1.2 `test/import-cycles.test.mjs`: the graph must stay acyclic.
- [x] 1.3 `test/package-files.test.mjs`: every root module is in `files[]`, every
  declared directory is copied by `sync-runtime.mjs`.

## 2. `bridge.mjs`: 3116 → 2955

- [x] 2.1 `paths.mjs` — runtime paths, the thought file, `SAY`.
- [x] 2.2 `state.mjs` (140) — the state file, `saveState`, `log`, `done`.
- [x] 2.3 `secrets.mjs` (81) — the credentials file and token lookup; 2955.

## 3. `bridge.mjs`: 2955 → 2011

- [x] 3.1 `commands.mjs` (97) — message-reading helpers and `GENERAL_SAFE`.
- [x] 3.2 `topics.mjs` — forums, seeding, the General lobby.
- [x] 3.3 `telegram.mjs` (173) — transport and the pending journal; 2670.
- [x] 3.4 `keys.mjs` — `sessionKey`/`threadOf`, split out to break the cycle the
  topics move would otherwise have made; 2530.
- [x] 3.5 `progress.mjs` (277) and `keyboards.mjs` — the status card and its
  buttons; 2230.
- [x] 3.6 `turn.mjs` (241) — running turns and their clocks; 2011.

## 4. `control.mjs`: 2734 → 97

- [x] 4.1 `control/` helpers: tasks, agent sets, sessions, plugins, models,
  release, agents — 1912.
- [x] 4.2 The 43-case switch became seven `control/cmd-*.mjs` group modules; the
  router is 97 lines.
- [x] 4.3 `bot-menu.mjs` regenerated from the same command list.

## 5. Dictionaries: 2024 → 8 + 434 + 218

- [x] 5.1 `i18n/<lang>/core.mjs` (214 keys) and `ctrl.mjs` (421 keys) for `ru`.
- [x] 5.2 Same split for `en`, parity test green.
- [x] 5.3 Same split for `zh`, parity test green.

## 6. The rest of `bridge.mjs`: 2012 → 411

- [x] 6.1 `media.mjs` (239) — voice, photos, attachments; 1788.
- [x] 6.2 `steer.mjs` (165) — mid-turn steers, `deliver` injected; 1644.
- [x] 6.3 `queue.mjs` (~190) — queues, albums, approvals, notices,
  `setMessageHandler`; 1474.
- [x] 6.4 `profile-view.mjs` (96) — profile resolution and the settings chip;
  1379.
- [x] 6.5 `handle-message.mjs` (475) — one message becomes one turn; 936.
- [x] 6.6 `callbacks.mjs` (419), `run-command.mjs` (57), `job-loops.mjs` (68) —
  button presses, button-typed commands, the clocks; 411.

## 7. Close the change

- [x] 7.1 The last `MIGRATION` entry is gone: the set is empty.
- [x] 7.2 Four tests repointed at the module that now holds the code they assert
  (`general-lobby`, `callback-auth`, `bridge-wiring`, `module-size`).
- [x] 7.3 `docs/REFACTORING.md` states the 500-line ceiling as the rule and
  records the sixteen steps.
- [x] 7.4 `node --test` 361/361, `node scan-secrets.mjs --all` clean.
- [x] 7.5 `openspec archive split-giant-files`.