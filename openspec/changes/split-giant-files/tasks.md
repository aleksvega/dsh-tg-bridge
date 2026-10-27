# Tasks

Each numbered step is one branch, one commit, one patch release. A step is done
only when `node --test` is green, `npm pack --dry-run` shows the file count grew
by exactly the number of new modules, and `node sync-runtime.mjs` into a scratch
root boots.

## 1. Make the ceiling enforceable before moving anything

- [ ] 1.1 Add `test/module-size.test.mjs`: read `package.json.files[]`, count lines of every `.mjs`, fail above 500; a `MIGRATION` set lists the files still too large so the test is green from the first commit.
- [ ] 1.2 Add `test/import-cycles.test.mjs`: build the import graph of the shipped modules, fail on a cycle.
- [ ] 1.3 Extract `paths.mjs` (70 lines): the path constants only, no imports beyond `node:os`/`node:path`/`node:url`.
- [ ] 1.4 Extract `state.mjs` (131): `config`, `state`, `writeAtomic`, `saveState`, `log`, `done`, `saveDone`, `ack`, `writePending`, `pendingUpdates`. Drop `bridge.mjs` from the `MIGRATION` set only when it is under 500, not earlier.
- [ ] 1.5 Release a patch with a CHANGELOG line "no behaviour change" and the line count before/after.

## 2. Transport

- [ ] 2.1 Extract `secrets.mjs` (65): `readSecret`, `providerKeys`, `findToken`, `token`.
- [ ] 2.2 Extract `telegram.mjs` (154): `api`, `tg`, `sendFile`, `downloadFile`, `sendWithMarkup`, `send`, `sendEphemeral`; `bridge.mjs` keeps a re-export of `send` so call sites stay untouched during the step.
- [ ] 2.3 Grep the test tree for every moved symbol and point the test at the new path in the same commit.

## 3. Keys and commands

- [ ] 3.1 Extract `commands.mjs` (78): `commandOf`, `GENERAL_SAFE`, `immediateCommandOf`, `langFor`, `lastTurnTarget`, `botUsername`.
- [ ] 3.2 Extract `topics.mjs` (165): thread/session keys, seed dedupe, `topicName`, `topicSeeded`, `ensureTopicSeed`, `logTopicToGeneral`.
- [ ] 3.3 Keep `test/general-lobby.test.mjs` and `test/topic-seed*.test.mjs` green — they read the source, so update their paths deliberately, not by deletion.

## 4. The turn

- [ ] 4.1 Extract `turn.mjs` (226): `runTurn`, `runTurnLive`, `typingLoop`, `killTurn`, `speedOf`.
- [ ] 4.2 Pass `activeTurns` and `liveSessions` explicitly if the move would otherwise duplicate them; that is a second commit with its own test.
- [ ] 4.3 Extract `progress.mjs` (237): `startProgress` and its timers; `panel.mjs` stays a pure renderer.
- [ ] 4.4 `test/panel-speed.test.mjs` and `test/turn-*.test.mjs` green.

## 5. Queue, steer, albums, approvals

- [ ] 5.1 Extract `queue.mjs` (103) including the busy notices and `maybeExitForRestart`.
- [ ] 5.2 Extract `steer.mjs` (133); `steer-queue.mjs` stays the file protocol.
- [ ] 5.3 Extract `albums.mjs` (39) and `approvals.mjs` (78).

## 6. Media and per-topic profile

- [ ] 6.1 Extract `media.mjs` (205): `transcribe`, `voiceToText`, `readVoiceIntoText`, `mediaPrompt`; `media-text.mjs` stays the pure text side.
- [ ] 6.2 Extract `topic-profile.mjs` (185): `profileOf`, `turnProfileOf`, `applyAsetJob`, the settings chip, the task card.

## 7. Routers

- [ ] 7.1 Extract `handle-message.mjs` (451). It lands at 90% of the ceiling: record in the file header that it may not grow, and cut the media branch first if it must.
- [ ] 7.2 Extract `callbacks.mjs` (401): `handleCallback`, `handleCardPress`, `boundSetOf`.
- [ ] 7.3 Reduce `bridge.mjs` to `main.mjs` (280) plus re-exports; the poller entry point and the `bin` mapping do not change.
- [ ] 7.4 Delete `bridge.mjs`'s `MIGRATION` entry: the file is now under 500 or gone.

## 8. control: the stores

- [ ] 8.1 `control/store-models.mjs` (191) — patch-file reading, model and effort resolution.
- [ ] 8.2 `control/store-plugins.mjs` (113) — plugin and bundle rows, `createProfile`, `dshPlugin`.
- [ ] 8.3 `control/store-sessions.mjs` (133) — session listing, titles, skills.
- [ ] 8.4 `control/store-agents.mjs` (172) — soul, agentsets, cards.
- [ ] 8.5 `control/release.mjs` (177) — update policy, install, npm lookups, pid waits.
- [ ] 8.6 `control/registry.mjs` (65) — command list, aliases, `reasoningOf`, `filterLogLines`.

## 9. control: the commands, one group per commit

- [ ] 9.1 `control/status.mjs` (206): `/status`, `/version`, `/doctor`, `/logs`.
- [ ] 9.2 `control/models.mjs` (199): `/models`, `/model`, `/effort`, `/reasoning`, `/permissions`, `/preset`, `/plan`.
- [ ] 9.3 `control/profile.mjs` (472): `/profile`, `/agents`, `/soul`, `/settings`, `/crew`, `/lang`; split `/agents` out if the module passes 500.
- [ ] 9.4 `control/plugins.mjs` (232): `/plugins`, `/plugin`, `/skills`.
- [ ] 9.5 `control/work.mjs` (320): `/task`, `/tasks`, `/goal`, `/jobs`, `/remind`, `/seed`, `/thoughts`.
- [ ] 9.6 `control/session.mjs` (176): `/sessions`, `/resume`, `/rewind`, `/fork`, `/branches`, `/new`, `/cd`.
- [ ] 9.7 `control/house.mjs` (220): `/restart`, `/app`, `/stop`, `/send`, `/prices`, `/update`, `/subscribe`, `/help`, `/menu`.
- [ ] 9.8 The registry dispatcher replaces the 1868-line switch; `test/control-*.test.mjs` green, `bot-menu.mjs` regenerated because the command list moved.

## 10. i18n

- [ ] 10.1 Split `ru` into six namespace files plus `rest.mjs`; `i18n.mjs` keeps exporting `t`.
- [ ] 10.2 Same for `en`, same commit as 10.1 only if the parity test covers both.
- [ ] 10.3 Same for `zh`; key-parity tests green.
- [ ] 10.4 Remove the last `MIGRATION` entries: the set is empty.

## 11. Close the change

- [ ] 11.1 `docs/REFACTORING.md` points at this change and states the 500-line ceiling as the rule.
- [ ] 11.2 `docs/ROADMAP.md` drops the "split the giants" item.
- [ ] 11.3 `openspec archive split-giant-files` once every task above is checked.
