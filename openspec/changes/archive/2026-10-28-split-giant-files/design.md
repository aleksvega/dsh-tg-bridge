# Design: how the giants come apart

## The seam rule

A function may move **as-is** only when everything it touches arrives as

1. an import,
2. a parameter, or
3. a module-level value it never mutates.

Anything that closes over `config`, `state`, `token`, `activeTurns` or
`liveSessions` is not a move — it is a signature change wearing a move's clothes.
Those functions move in a *second* commit that introduces an explicit `ctx`
object, so a red test can only mean one thing.

## Layers

```
L0  paths.mjs           DSH_HOME, DIR, STATE, LOG, PID_FILE — constants, no imports
L1  state.mjs           config, state.json, done.json, pending journal
L1  secrets.mjs         credentials.yaml, provider keys, bot token
L2  telegram.mjs        api(), tg(), send(), sendWithMarkup(), files
L2  topics.mjs          sessionKey, threadOf, topic names, seeds, General log
L2  commands.mjs        commandOf, immediateCommandOf, GENERAL_SAFE, langFor
L3  turn.mjs            runTurn, runTurnLive, killTurn, typingLoop, speedOf
L3  progress.mjs        startProgress, the panel lifecycle
L4  handle-message.mjs  one message in, one turn out
L4  callbacks.mjs       one button in, one action out
L5  main.mjs            the poller and the wiring
```

A module may import from a lower layer and never sideways into `bridge.mjs`.
`control/*` sits beside L2 and must not import anything from the bridge side:
today `control.mjs` imports no bridge module and that is what keeps the
dependency acyclic.

## `bridge.mjs` → 17 modules (2966 lines)

Line counts are the measured span of each declaration group, comments included.

| Module | Lines | Contents |
| --- | --- | --- |
| `paths.mjs` | 70 | `HOME`, `DSH_HOME`, `DIR`, `STATE`, `LOG`, `PID_FILE`, `RESTART_MARKER`, `EXE`, `CLI_JS` |
| `state.mjs` | 131 | `config`, `state`, `writeAtomic`, `saveState`, `log`, `done`, `saveDone`, `ack`, `writePending`, `pendingUpdates` |
| `topic-profile.mjs` | 185 | `profileOf`, `settingsChipOf`, `profileRowOf`, `turnProfileOf`, `applyAsetJob`, `taskRows`, `renderTaskCard` |
| `secrets.mjs` | 65 | `readSecret`, `providerKeys`, `findToken`, `token` |
| `telegram.mjs` | 154 | `api`, `tg`, `sendFile`, `downloadFile`, `sendWithMarkup`, `send`, `sendEphemeral` |
| `commands.mjs` | 78 | `botUsername`, `commandOf`, `GENERAL_SAFE`, `immediateCommandOf`, `langFor`, `lastTurnTarget` |
| `topics.mjs` | 165 | `threadOf`, `sessionKey`, `newestBoundTopic`, `touchTopic`, seed dedupe, `topicName`, `topicSeeded`, `ensureTopicSeed`, `logTopicToGeneral` |
| `media.mjs` | 205 | `transcribe`, `voiceToText`, `readVoiceIntoText`, `mediaPrompt` |
| `turn.mjs` | 226 | `runTurn`, `typingLoop`, `killTurn`, `runTurnLive`, `speedOf` |
| `progress.mjs` | 237 | `startProgress` and its panel timers |
| `handle-message.mjs` | 451 | `handleMessage` — the routing switch |
| `queue.mjs` | 103 | `queues`, `acquire`, `release`, `enqueue`, busy notices, `maybeExitForRestart` |
| `steer.mjs` | 133 | `steerAvailable`, `steerRunningTurn`, `watchSteer`, `steerMediaMessage` |
| `albums.mjs` | 39 | the album buffer wiring |
| `approvals.mjs` | 78 | `requestApproval`, the three keyboards, `lastPrompt`, `approvals` |
| `callbacks.mjs` | 401 | `handleCallback`, `handleCardPress`, `boundSetOf` |
| `main.mjs` | 280 | `main()` — poll loop, startup notices, wiring |

`handle-message.mjs` at 451 is the one module that starts near the ceiling. It
must not grow: the media branch already has `media-text.mjs` next door, and a
second router (voice, album, callback) is the natural next cut.

## `control.mjs` → 13 modules (2759 lines)

| Module | Lines | Contents |
| --- | --- | --- |
| `control/registry.mjs` | 65 | `CONTROL_COMMANDS`, `COMMAND_ALIASES`, `DOCUMENTED_COMMANDS`, `reasoningOf`, `filterLogLines`, and the dispatcher that replaced the switch |
| `control/store-models.mjs` | 191 | `modelsOf`, `modelOf`, `windowOf`, `modelsReport`, `setModel`, `setDisabled`, `writePatch` |
| `control/store-plugins.mjs` | 113 | `pluginsOf`, `bundleRowIds`, `addBundle`, `removeBundle`, `createProfile`, `dshPlugin` |
| `control/store-sessions.mjs` | 133 | `cwdSlug`, `stamp`, `agentsOf`, `fleetOf`, `recentSessions`, `sessionTitle`, `skillsOf` |
| `control/store-agents.mjs` | 172 | `soulOf`, `setSoul`, the agentset store, cards and keyboards, `goalView`, `taskView` |
| `control/release.mjs` | 177 | `updatePolicy`, `copyRelease`, `installRelease`, `npmLatest*`, `listPids`, `waitForExit` |
| `control/status.mjs` | 206 | `/status`, `/version`, `/doctor`, `/logs` |
| `control/models.mjs` | 199 | `/models`, `/model`, `/effort`, `/reasoning`, `/permissions`, `/preset`, `/plan` |
| `control/profile.mjs` | 472 | `/profile`, `/agents`, `/soul`, `/settings`, `/crew`, `/lang` |
| `control/plugins.mjs` | 232 | `/plugins`, `/plugin`, `/skills` |
| `control/work.mjs` | 320 | `/task`, `/tasks`, `/goal`, `/jobs`, `/remind`, `/seed`, `/thoughts` |
| `control/session.mjs` | 176 | `/sessions`, `/resume`, `/rewind`, `/fork`, `/branches`, `/new`, `/cd` |
| `control/house.mjs` | 220 | `/restart`, `/app`, `/stop`, `/send`, `/prices`, `/update`, `/subscribe`, `/help`, `/menu` |

Each command module exports `{ run(ctx, arg) }`; the registry keeps the command
list, the aliases and the dispatch, so adding a command stops meaning editing a
1868-line switch. `/agents` alone is 167 lines inside `control/profile.mjs`: if
that module passes 500, `/agents` becomes `control/agents.mjs` in its own commit.

## `i18n` → 3 × 6 modules (654 lines each, 624 keys)

The `ctrl.` namespace alone is 418 keys, so splitting by top-level prefix is not
enough. Split by second segment:

```
i18n/ru/index.mjs        merges the six, exports the same default object
i18n/ru/ctrl-status.mjs  /status /doctor /logs /version
i18n/ru/ctrl-model.mjs   /model /models /effort /reasoning /permissions /preset /plan
i18n/ru/ctrl-profile.mjs /profile /agents /soul /settings /crew /lang
i18n/ru/ctrl-plugin.mjs  /plugins /plugin /skills
i18n/ru/ctrl-work.mjs    /task /tasks /goal /jobs /remind /seed /thoughts
i18n/ru/ctrl-house.mjs   /restart /app /stop /send /prices /update /subscribe /help /menu
i18n/ru/rest.mjs         bridge, settings, menu, msg, status, profile, task, cmd, goal, prompt, btn, err, steer, help
```

`i18n.mjs` stays as the loader and keeps exporting `t`, so no call site changes.
The existing key-parity tests compare `en`, `ru` and `zh` key by key; they must
keep passing at every step, which is what makes a mechanical split safe here.

## Enforcement, not intention

Two new tests, added in the first step, before any code moves:

- `test/module-size.test.mjs` — reads `package.json.files[]`, counts lines of
  every `.mjs`, fails above 500. A `MIGRATION` set lists the files still too
  large; the test is green on day one and only goes red when a module grows back
  or a new one overshoots. Each step deletes its own entry from the set, so the
  set is the progress bar.
- `test/import-cycles.test.mjs` — builds the `import` graph of the shipped
  modules and fails on a cycle. Node does not report a cycle; it reports
  `undefined is not a function` at call time, three frames deep.

Both are cheap (no network, no spawn) and both run in CI on Ubuntu and Windows.

## Cycles and state: the two ways this goes wrong

1. **A cycle.** Moving `send` out while `send` calls `langFor` and `langFor`
   reads `state` can close a loop. Order the steps so each extracted module
   imports only what is already extracted, and run the suite after every file,
   not after every step.
2. **Module-level state.** `token` is computed at import time; `activeTurns` is
   mutated by the turn runner. Moving `runTurn` without passing `activeTurns`
   turns a shared map into two maps, and the symptom is `/stop` that does not
   stop. Pass the map, or keep the owner.

## Sequencing

Leaf first, one commit and one patch release per step:

1. structural tests + `paths.mjs` + `state.mjs`
2. `secrets.mjs` + `telegram.mjs`
3. `commands.mjs` + `topics.mjs`
4. `turn.mjs` + `progress.mjs`
5. `queue.mjs` + `steer.mjs` + `albums.mjs` + `approvals.mjs`
6. `media.mjs` + `topic-profile.mjs`
7. `handle-message.mjs` + `callbacks.mjs` + `main.mjs` (bridge is now a wiring file)
8. `control/store-*.mjs` (six stores, one commit each if the diff is large)
9. `control/*.mjs` command groups, one group per commit
10. `i18n` namespaces, one locale per commit

## Rollback

Every step is a branch and one commit. A red suite that is not understood in
fifteen minutes means `git revert` and a note in `docs/ROADMAP.md`. A move that
is half-finished is worth less than a release that works.
