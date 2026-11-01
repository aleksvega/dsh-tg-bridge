# Stability first, then parity, and an install that can always be updated

## Why

An expert review of the running product found three classes of defect that no
feature on the parity list can compensate for.

**The bot can go silent forever.** `kick.log` holds **299 lines** of
`marker present but pid N alive`: `applyRollback` writes `restart.pending`
(`core/stability.mjs:327`), but only a *running* bridge clears it
(`turn/queue.mjs:70-76`). When the pid in the file is alive but wedged, the
supervisor takes the early return (`bridge-kick.mjs:209`) and logs once a minute,
for 175 minutes in the longest observed episode. `/doctor` and `/logs` read
`bridge.log`, so nothing the person can reach shows it.

**The install has no schema.** `state.json` and `config.json` are parsed and used
as-is (`core/state.mjs:27-35`); a renamed key becomes `undefined` at every read
site, and the next `saveState()` writes the degraded shape back. There is no
version field and no migration anywhere in the repo.

**Two promises the code does not keep.** `requestApproval()`
(`turn/queue.mjs:198`) has no caller, so the approval buttons in
`chat/callbacks.mjs` can never fire — while the README advertises tool
confirmations. And the allowlist accepts `chat.id` (`core/allowlist.mjs:14`), so
listing a group grants every member a full agent turn on the host.

The parity work already specified in `2026-11-01-desktop-parity` and
`2026-11-01-turn-insight` is worth doing — but only after these, and in an order
that follows daily value rather than the order the cards were designed.

## What changes

1. **A stability contract.** A restart marker expires; one supervisor tick can
   start one bridge; a rollback never repeats inside its cooldown; an unhandled
   rejection ends the process instead of leaving it half-alive; every accepted
   update is acknowledged even when its handler throws; a corrupt `state.json`
   is reported, not silently reset.
2. **A trust contract.** Identity is the person, not the chat; the approval
   subsystem either asks in the chat or is removed with its README claim; every
   log line that leaves the process is redacted; inlined documents and
   transcripts are fenced as data; a turn child gets an allowlisted environment
   instead of `process.env`.
3. **An updatable install.** `state.json` and `config.json` gain a version and a
   migration ladder; a release is verified *before* it is copied over the root;
   local drift is detected; backups are pruned; an update is refused while a turn
   runs; an unproven release is never a rollback target.
4. **A parity order**, written into the existing change: wire approvals (5 h),
   file browser (6 h), plan mode (8 h), mid-turn questions (6 h), terminal
   (10 h), inline hints (4 h, after @BotFather), plugin settings (12 h).
5. **Three deletions**: the chat-driven plugin install, `/logs file` as a
   document for non-owners, and either the dead approval path or its claim.

## Non-goals

- No rewrite of the turn pipeline. The two P0 stability fixes are one `stat` and
  one persisted timestamp.
- No new dependency, no database, no ORM: the migration ladder is a switch on an
  integer.
- No parity feature is implemented in this change. It orders the two existing
  changes; the code lands there.
- No effort to make Telegram a screenshot of the desktop: three surfaces
  (browser tabs, trajectory chart, native directory picker) are declared
  out of scope with a reason in the parity proposal.

## Definition of done

1. Each P0 requirement has a test that fails on the previous revision: stale
   marker, double start, repeated rollback, unacked update.
2. A fixture `state.json` written by the previous version loads, migrates, and
   keeps its sessions; an unknown future version is refused with a sentence, not
   a crash.
3. `installRelease` validates the staged copy before the copy over the root; a
   crash between the two leaves the old install runnable.
4. A group message from an unlisted user is refused even when the chat is listed;
   a listed private chat still works.
5. The approval surface either produces a card on an `ask` profile or is absent
   from code, strings and README in the same commit.
6. `/logs` and `/logs file` pass through `redact()`; a fixture log with a bot
   token and an `sk-` key produces no match in the chat payload.
7. `npm test` green, no module over 500 lines, three locales for every new string.

## Impact

- **Users**: fewer silent stops, an update that can be undone, and no claim of a
  protection that does not exist.
- **Maintainer**: the bar is a failing test per fix, as `2026-10-31-acceptance-bar`
  already requires. The migration ladder is the only new concept.
- **Risk**: a migration that runs in the wrong order can lose sessions. That is
  why the version is written before the ladder and the backup is taken before
  the first write under a new version.
