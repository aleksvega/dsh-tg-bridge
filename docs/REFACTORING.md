# Refactoring the bridge without ever shipping a broken version

**Done, on `refactor/split-giant-files`: `bridge.mjs` went from 3116 lines to
411, `control.mjs` from 2734 to 97, the dictionaries from 2024 to a 8-line
header plus two namespaces, and no shipped module is over 500 lines.** The
ceiling is enforced by `test/module-size.test.mjs` rather than by review, and
that test's `MIGRATION` list — which used to hold the files still waiting — is
now empty. The plan and its forty-five tasks live in
`openspec/changes/archive/2026-10-28-split-giant-files/`, and the ceiling itself
is a spec in `openspec/specs/module-structure/spec.md`.

Three modules carried most of the code: `bridge.mjs` (3116 lines, 68
functions), `control.mjs` (2734), `i18n.mjs` (2024). Everything else was under
320. That was not a style preference — it was a risk profile: a 3000-line file
means every change is reviewed against 3000 lines of neighbours, and the two
worst bugs of 1.19.x (a broken `/update confirm`, an allowlist that one branch
skipped) both lived in those files and were invisible to a reader.

## The rule this document exists to protect

**The published version is always green.** Refactoring is not allowed to make
`master` worse at any point, and a person who runs `/update` must never receive
a half-moved file. Everything below follows from that.

## Invariants

1. `node --test` is green before the first edit and after every step. It is the
   only thing that makes moving code safe: 361 tests, ~40 s, no network.
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

## What happened, in order

Every line below is one commit; the number after the arrow is the line count of
the file that gave the code up.

| # | Moved to | What it took over | `bridge.mjs` |
| --- | --- | --- | --- |
| 1 | `paths.mjs`, `state.mjs` | Runtime paths, the state file and its save rules | 3116 → 2955 |
| 2 | `secrets.mjs` | The credentials file, token lookup | → 2895 |
| 3 | `commands.mjs`, `topics.mjs` | Message-reading helpers, forum topics | → 2817 |
| 4 | `telegram.mjs` | Transport: `tg`, `send`, `sendFile`, the pending journal | → 2670 |
| 5 | `keys.mjs` | `sessionKey`/`threadOf` — split out because the topics move would have made a cycle | → 2530 |
| 6 | `progress.mjs`, `keyboards.mjs` | The status card and its buttons | → 2230 |
| 7 | `turn.mjs` | Running turns, their clocks, `typingLoop` | → 2011 |
| 8 | `control/` helpers | Task, agent-set, session, plugin, model and release helpers | `control.mjs` 2734 → 1912 |
| 9 | `control/cmd-*.mjs` | The 43-case switch became seven group modules | → 97 |
| 10 | `i18n/{lang}/{core,ctrl}.mjs` | Each dictionary split in two namespaces | dictionaries 2024 → 434 + 218 |
| 11 | `media.mjs` | Voice, photos, attachments | `bridge.mjs` 2012 → 1788 |
| 12 | `steer.mjs` | Mid-turn steers (job file, ack, fallback) | → 1644 |
| 13 | `queue.mjs` | Queues, albums, approvals, notices | → 1474 |
| 14 | `profile-view.mjs` | Profile resolution, the settings chip, agent-set jobs | → 1379 |
| 15 | `handle-message.mjs` | One incoming message becomes one turn | → 936 |
| 16 | `callbacks.mjs`, `run-command.mjs`, `job-loops.mjs` | Every button press, button-typed commands, the clocks | → 411 |

Largest module now: `handle-message.mjs` at 475. `bridge.mjs` is the update
loop, the allowlist, the wiring and `main()`.

## The protocol for one step

1. `git switch -c refactor/<step>` from a green `master`.
2. Move code with `git mv`/cut-paste. Do not reformat, rename, or "improve while
   here" — the diff must read as a move.
3. Keep the old module exporting the same names (a one-line re-export) until the
   step is green, so callers never break mid-move.
4. `node --test`. Then `npm pack --dry-run` and check the file count grew by
   exactly the number of new modules.
5. Commit as `refactor N/M: <what moved>; <file> A to B`. Merge to `master` only
   with the suite green.
6. Publish a patch release with a CHANGELOG line that says "no behaviour change"
   and the line counts before/after. `/update confirm` then carries the move to
   users, and `/version` proves which file set they run.
7. If anything is red and not understood in 15 minutes: `git checkout master`,
   delete the branch, keep the note in `docs/ROADMAP.md`. A move that is not
   finished is worth less than a release that works.

## What breaks, and how likely it is

- **Import cycles** (the most frequent, and the reason `keys.mjs` exists).
  Node reports a cycle as `undefined` at call time, not as an error. Guard: move
  leaf modules first, and run the suite after every single file, not after the
  whole step. Where a cycle is unavoidable, inject behaviour instead of importing
  upward: `queue.mjs` exports `setMessageHandler(fn)` and the entry calls it,
  `steer.mjs` takes a `deliver` callback.
- **Module-level state** (config, `state`, `DSH_HOME`, `activeTurns`) is read at
  import time in several helpers. Moving a function that closes over that state
  turns it into a function that needs it passed in — that is a *behaviour* change
  in disguise. Guard: move only functions whose dependencies are already
  parameters, or pass an explicit context object in a separate commit.
- **Singleton state must keep exactly one copy.** `queues`, `approvals`,
  `busyNotices`, `albumBuffer` and the message-edit debounce in `telegram.mjs`
  are imported by both the poller and the modules that write to them; a second
  copy of any of them breaks `/stop`, notices and status edits *silently*.
- **The runtime sync** (silent, and it bites only users): `sync-runtime.mjs` and
  `cli.mjs` copy `files[]` entries into `~/.dsh/tg-bridge`. A new subdirectory
  (`i18n/`) needed a `mkdirSync` that did not exist — found and fixed in step 1.
  Guard: after each step, run `node sync-runtime.mjs` into a scratch
  `DSH_BRIDGE_ROOT` and boot the bridge from there.
- **Lost tests** (silent): a test that imported the moved function by path
  fails, which is fine; a test that imported it *through* the old module keeps
  passing and quietly stops covering the new file. Guard: grep the test tree for
  every moved path in the same commit. Four tests needed repointing by name in
  this refactor (`general-lobby`, `callback-auth`, `bridge-wiring`,
  `module-size`).

Probability of shipping a broken release if the protocol above is followed: low.
The two 1.19.x faults were not caused by moving code — they were caused by
writing new code without a test. A move with 361 tests behind it is the safest
kind of change this project has.

## What not to do

- Do not rewrite a module from scratch "properly". A rewrite has no diff, and
  this code is full of decisions that only exist as comments (why General
  recovers into the last topic, why a steer is a file, why the goal keeps its
  number on edit). Those comments are the specification.
- Do not split by line count alone. `handle-message.mjs` at 475 lines is one
  decision — what a message becomes — and is deliberately the largest file left.
- Do not refactor while a release is pending or a user is mid-update.
