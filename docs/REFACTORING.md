# Refactoring the bridge without ever shipping a broken version

Three modules carry most of the code: `bridge.mjs` (2900 lines, 68 functions),
`control.mjs` (2600), `i18n.mjs` (2024). Everything else is under 320. That is
not a style preference — it is a risk profile: a 2900-line file means every
change is reviewed against 2900 lines of neighbours, and the two worst bugs of
1.19.x (a broken `/update confirm`, an allowlist that one branch skipped) both
lived in those files and were invisible to a reader.

## The rule this document exists to protect

**The published version is always green.** Refactoring is not allowed to make
`master` worse at any point, and a person who runs `/update` must never receive
a half-moved file. Everything below follows from that.

## Invariants

1. `node --test` is green before the first edit and after every step. It is the
   only thing that makes moving code safe: 338 tests, ~15 s, no network.
2. A step changes *where code lives*, never what it does. A behaviour change and
   a move never share a commit — when a test goes red, you must be able to tell
   which of the two caused it.
3. Each step is one commit, one patch release, one `/restart confirm`. A step
   that cannot be shipped alone is too big.
4. The tarball stays complete: `test/package-files.test.mjs` fails if a module
   is imported but not listed in `files[]`, and `test/engines.test.mjs` fails if
   the Node floor and the code drift apart. Both run in CI on Ubuntu and Windows.
5. `git` history keeps the old file: `git log --follow` must still answer "why is
   this line here" after a move. Use `git mv` where possible, and never squash a
   move into a feature commit.

## What is actually worth splitting

Ordered by risk reduction per hour. Nothing here is speculative: each line names
the seam that already exists in the code.

| Step | Move | From → to | Why it is safe |
| --- | --- | --- | --- |
| 1 | Dictionary per locale | `i18n.mjs` 2024 → `i18n.mjs` 94 + `i18n/{en,ru,zh}.mjs` ~640 each | Pure data. `test/i18n-*.test.mjs` already compares the three tables key by key, so a lost key fails the build. |
| 2 | Transport | `tg`, `send`, `sendFile`, `downloadFile`, `ack`, `sendEphemeral`, `pendingPath`, `readSecret`, `findToken` → `telegram.mjs` | These touch `fetch` and the pending-update journal only; no command logic. |
| 3 | Turn runner | `runTurn`, `killTurn`, `typingLoop`, `startProgress` → `turn.mjs` | One function with one contract (`{sessionId, text, error}`), and the `error` listener added in 1.19.6 is a natural boundary. |
| 4 | Steer | `steerAvailable`, `steerRunningTurn`, `watchSteer`, `steerMediaMessage` → `steer.mjs` | Already a self-contained protocol (job file, ack, fallback) with `steer-queue.mjs` next to it. |
| 5 | Topics | `threadOf`, `sessionKey`, `newestBoundTopic`, `touchTopic`, `topicSeeded`, `ensureTopicSeed`, `topicName`, `logTopicToGeneral` → `topics.mjs` | Pure functions over `state`, plus two Telegram calls that step 2 has already moved. |
| 6 | Commands by area | `control.mjs` → `commands/{sessions,plugins,models,goals,logs,update}.mjs`, router stays | The `switch` already has one `case` per command; each case becomes one export. |
| 7 | Media | `transcribe`, `voiceToText`, `readVoiceIntoText`, `mediaPrompt` → merge into `media-text.mjs` | The file already exists for the text side of the same job. |

Target after step 6: no module over ~700 lines, `bridge.mjs` reduced to the
update loop, the allowlist, the queue and the wiring.

## The protocol for one step

1. `git switch -c refactor/<step>` from a green `master`.
2. Move code with `git mv`/cut-paste. Do not reformat, rename, or "improve while
   here" — the diff must read as a move.
3. Keep the old module exporting the same names (a one-line re-export) until the
   step is green, so callers never break mid-move.
4. `node --test`. Then `npm pack --dry-run` and check the file count grew by
   exactly the number of new modules.
5. Commit as `refactor: <what moved>`. Merge to `master` only with the suite
   green.
6. Publish a patch release with a CHANGELOG line that says "no behaviour change"
   and the line counts before/after. `/update confirm` then carries the move to
   users, and `/version` proves which file set they run.
7. If anything is red and not understood in 15 minutes: `git checkout master`,
   delete the branch, keep the note in `docs/ROADMAP.md`. A move that is not
   finished is worth less than a release that works.

## What breaks, and how likely it is

- **Import cycles** (most likely, ~70% of the pain). `bridge.mjs` and
  `control.mjs` already import each other's neighbours; splitting can create a
  cycle that Node reports as `undefined` at call time, not as an error. Guard:
  move leaf modules first (steps 1–3 have no callbacks into the bridge), and run
  the suite after every single file, not after the whole step.
- **Module-level state** (config, `state`, `DSH_HOME`, `activeTurns`) is read at
  import time in several helpers. Moving a function that closes over that state
  turns it into a function that needs it passed in — that is a *behaviour* change
  in disguise. Guard: move only functions whose dependencies are already
  parameters, or pass an explicit context object in a separate commit.
- **The runtime sync** (silent, and it bites only users): `sync-runtime.mjs` and
  `cli.mjs` copy `files[]` entries into `~/.dsh/tg-bridge`. A new subdirectory
  (`i18n/`) needed a `mkdirSync` that did not exist — found and fixed in step 1.
  Guard: after each step, run `node sync-runtime.mjs` into a scratch
  `DSH_BRIDGE_ROOT` and boot the bridge from there.
- **Lost tests** (silent): a test that imported the moved function by path
  fails, which is fine; a test that imported it *through* the old module keeps
  passing and quietly stops covering the new file. Guard: grep the test tree for
  every moved path in the same commit.

Probability of shipping a broken release if the protocol above is followed: low.
The two 1.19.x faults were not caused by moving code — they were caused by
writing new code without a test. A move with 338 tests behind it is the safest
kind of change this project has.

## What not to do

- Do not rewrite a module from scratch "properly". A rewrite has no diff, and
  this code is full of decisions that only exist as comments (why General
  recovers into the last topic, why a steer is a file, why the goal keeps its
  number on edit). Those comments are the specification.
- Do not split by line count alone. `setup.mjs` at 314 lines is fine;
  `control.mjs` at 2600 is a router plus 40 unrelated commands.
- Do not refactor while a release is pending or a user is mid-update.
