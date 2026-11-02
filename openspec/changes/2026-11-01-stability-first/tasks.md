# Tasks — stability contract, trust contract, updatable install

## 0. P0 stability (do first, one commit each)

- [x] 0.1 `bridge-kick.mjs`: clear a `restart.pending` older than ten minutes when
  the pid is alive; log one line. Test: stale marker + live pid → marker gone, no
  second bridge.
  → `clearStaleMarker()`, ten minutes by mtime. It was not even logging the old
  case correctly: the marker was kept forever, so a later start announced an
  interrupted turn that was months old. `test/supervision.test.mjs` runs the real
  tick against a temp home whose `bridge.pid` names the test process: an 11-minute
  marker goes away with one line, a fresh one stays.
- [ ] 0.2 Start lock: an exclusive file taken before spawn; a second tick inside
  the window exits. Test: two ticks 100 ms apart → one spawn.
  → Half true, and the half that is missing is the one that matters. The lock is
  taken before spawn and released on exit (`acquireLock`, shared with `setup.mjs`,
  with a three-minute staleness takeover). But the window ends when the tick
  exits, which is before the child has written its pid file — so a tick 100 ms
  later can still start a second bridge. Closing it means holding the lock until
  the pid file appears, and that needs a test with a deliberately slow stub.
- [x] 0.3 Rollback cooldown persisted and at least twice the tick interval. Test:
  two ticks inside the cooldown → one restore, one message.
  → `startupRolledBackAt` in state; "the supervisor does not repeat a rollback it
  just performed" in `test/stability.test.mjs`.
- [x] 0.4 `unhandledRejection` → log + `process.exit(1)`. Test: a rejected promise
  ends the process.
  → It only logged. A bridge that half-failed kept answering nothing while
  `/doctor` showed a healthy process; now it exits and the minute tick starts a
  clean one. No automated test: spawning the real bridge claims the pid file and
  talks to Telegram. Test is manual — a rejected promise in a scratch profile.
- [ ] 0.5 `enqueue` acknowledges on rejection too. Test: a throwing handler leaves
  no pending entry.
  → The journal bracket is tested (`replay-once.test.mjs`), the rejection path is
  not. Still open.
- [x] 0.6 Corrupt `state.json`: keep `.bad`, log the parse error. Test: invalid
  JSON → file kept, log line, empty state.
  → It silently became an empty state: goals, schedules and sessions disappeared
  with no trace. `core/state.mjs` now copies the file to `state.json.bad` (first
  one wins), logs the parse error, and starts empty.
- [x] 0.7 `/doctor` rows: marker state and the age of the last `kick.log` line.
  → `control/doctor-rows.mjs` (its own module: `cmd-bridge.mjs` is at the 500-line
  ceiling) with `describeAge`, plus the six strings in their own
  `i18n/<lang>/supervision.mjs` table for the same reason.

## 1. P0 trust

- [ ] 1.1 `allowedSender`: person id only in groups; chat id only for
  `chat.type === 'private'`. Test: listed group + unlisted sender → refused;
  private listed chat → accepted.
- [ ] 1.2 Same rule on the steer path and on every callback press.
- [ ] 1.3 Approvals: wire `requestApproval` to the turn's approval event, or
  delete `requestApproval`, the `ap:` route, `approvalKeyboard` and the README
  claim in one commit. Test: the chosen branch is asserted end to end.
- [ ] 1.4 `redact()` on every chat-bound log line and on `/logs file`; refuse the
  document outside the owner's private chat. Test: fixture with a token and a key
  → no match.
- [ ] 1.5 Data fence around inlined documents, captions and transcripts. Test:
  fence markers present, caption outside the fence.
- [ ] 1.6 Turn environment from an allowlist, not `process.env`. Test: an
  undeclared variable is absent in the child.
- [ ] 1.7 `/plugin add` from a button → typed command only. Test: a press answers
  with the command.

## 2. P0 updatable install

- [ ] 2.1 `version` in `state` and `config`, ladder function, unknown-future
  refusal. Test: old fixture migrates; future version is refused.
- [ ] 2.2 `.bak` before the first save under a new version. Test: failing
  migration leaves the originals.
- [ ] 2.3 `installRelease`: stage → check → promote. Test: broken staged copy
  leaves the root untouched.
- [ ] 2.4 Ship hashes + drift report + typed confirmation. Test: edited file is
  named before replacement.
- [ ] 2.5 Prune `update-backup-*` to three. Test: six backups → three remain.
- [ ] 2.6 Refuse `/update confirm` while `activeTurns` is non-empty. Test: busy
  topic → refusal names it.
- [ ] 2.7 Rollback target excludes `unproven`; proven after one good turn. Test:
  two faults on a fresh release → target is the last proven one.
- [ ] 2.8 Interruption notice on every restart path. Test: update during a turn
  notifies that topic.

## 3. Parity order (written, not implemented here)

- [ ] 3.1 `2026-11-01-desktop-parity/proposal.md` gains the order from the gap
  map and the three out-of-scope surfaces with reasons.
- [ ] 3.2 `2026-11-01-turn-insight/proposal.md` states it runs after approvals,
  because the panel's value depends on a working per-topic state.

## 4. Acceptance

- [x] 4.1 `npm test` green with `DSH_HOME` unset; no module over 500 lines; no new
  dependency. (950 tests at the last run.)
- [ ] 4.2 Each P0 has a test that fails on the previous revision (checked by
  reverting the fix locally).
  → Three of the four fixes above have one. 0.4 does not, and 0.2 has none because
  it is not fixed.
- [ ] 4.3 Three locales for every new string.
  → Done for everything added so far (`supervision.mjs` in all three).
- [ ] 4.4 A release notes every behaviour change and its limit; the migration is
  named in `CHANGELOG.md`.
  → Open: these fixes are unreleased.
