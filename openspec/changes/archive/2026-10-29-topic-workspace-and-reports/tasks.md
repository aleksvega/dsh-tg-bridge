# Tasks — topic workspace, per-topic permissions, bug reports

## 0. Write the two rows together, always

- [x] 0.1 `patch-rows.mjs`: one `setPermission(patch, preset, workspaceRoot)` that
  writes `defaultPreset` **and** the `sandbox-policy` row (`mode` from the
  chosen preset, `workspaceRoot`), so the file cannot end up disagreeing with
  itself.
  → Shipped in `permission-rows.mjs`, not `patch-rows.mjs`: that file is now only
  the `MODEL`/`PRESETS` helpers, and the two permission rows have one owner.
  `setPermission(patch, { preset, sandbox, workspaceRoot })` writes both rows in
  one pass; `checkPermission(patch)` reads them back and reports disagreement.
- [x] 0.2 `test/patch-rows.test.mjs`: after a call, both rows name the same mode;
  a patch that had only one row gains the other.
  → `test/permission-rows.test.mjs` (9 tests): both rows agree after a call, a
  patch with only the table gains the sandbox row and vice versa, and a
  hand-edited file that disagrees is reported rather than trusted.
- [x] 0.3 Startup check: `defaultPreset` missing from the table is a refusal at
  boot with one line, not a turn that dies on its first tool call.
  → `effectivePreset` returns `null` and `turnPlan` refuses the turn with
  `bridge.turn.noPolicy` naming the reason; the check runs where the turn is
  planned, which is the first moment the answer matters (a profile can gain its
  table while the bridge runs).
- [x] 0.4 `/permissions` reads the *effective* preset from `defaultPreset` (today
  it reads the table and the table's current value — the same thing only
  because nobody edits the row by hand).
  → `effectivePreset(patch)` resolves `defaultPreset` → sandbox row → `unknown`,
  and `presetOf(key)` reads the *derived* profile, so the card and the command
  agree even when the row was edited by hand.

## 1. Make the boundary real before making it settable

- [x] 1.1 `aset-profile.mjs`: accept `workspace` in a set; hash it into
  `derivedName`; write `sandbox-policy.workspaceRoot` in `overlayPatch`.
  → `derivedName(base, set, workspace)` includes the workspace in the hash;
  `overlayPatch` writes the preset row, the sandbox row and `workspaceRoot`
  together whenever either is a delta. `materialiseProfile(set, base, {profiles,
  workspace})` also materialises a bare bound directory (`{id:'workspace'}`).
- [x] 1.2 `profile-edit.mjs`: a `setRowConfig` path for
  `@deepseek-ai/dsh-sandbox-policy` → `config.workspaceRoot`, replacing the
  existing line rather than appending a second row.
  → Done differently, and deliberately: `profile-edit.mjs` gained the two
  primitives that were actually missing — `rowExists(text, pkg)` and
  `appendRow(text, { id, pkg, config })` — and `permission-rows.mjs` owns the
  whole row, so "replace one key inside the sandbox row" never has to exist as a
  separate path that could append a second row. The guarantee the task asked for
  (one row, edited in place) is what `setPermission` tests.
- [x] 1.3 `test/aset-profile.test.mjs`: a set with `workspace` produces a profile
  whose `workspaceRoot` is that directory and whose base row is unchanged.
- [x] 1.4 Refuse the turn, not the profile, when the overlay for a *narrower*
  preset cannot be materialised: `turnProfileOf` returns an error, `handle-message`
  answers one line and does not spawn.
  → `turnPlan(key)` returns `{ error }`; `handle-message.mjs` sends
  `bridge.turn.noPolicy` and returns before `runTurnLive`.

## 2. `/cd` that survives a real filesystem

- [x] 2.1 Extract resolution into `control/cd-path.mjs`: pure `(input, {home, projectsDir, configCwd, isDir}) -> {path} | {error}`.
  → `resolveCd(input, { home, projectsDir, configCwd, probe })` returns
  `{ path, kind }` or `{ error: 'empty'|'none'|'notdir', path }`, where `kind` is
  `ABSOLUTE|HOME|PROJECT|RELATIVE`.
- [x] 2.2 Table-driven test: drive letter, UNC, POSIX absolute, `~`, bare name,
  existing file (not a directory), missing path, `reset`.
  → `test/cd-path.test.mjs` (4 tests, one table).
- [x] 2.3 `/cd` binds `workspaceRoot` to the same directory by default and says
  so in one line; `/cd <dir> wide` is the explicit escape hatch.
  → `/cd <dir>` replies `cmd.cd.boundNarrow` on a permission-enabled profile and
  `cmd.cd.bound` otherwise; `/cd <dir> wide` sets `state.wide[key]` and replies
  `ctrl.cd.boundWide`; bare `/cd` shows the binding and which of the two it is.
- [x] 2.4 A bound directory that disappeared is reported as such instead of
  falling back to `config.cwd` (`turn.mjs:39`).
  → `handle-message.mjs` checks `existsSync` on the bound directory and sends
  `bridge.turn.noDir` with the path, then returns.

## 3. Per-topic permission preset

- [x] 3.1 `/permissions` writes the topic's set (not the profile) when the topic
  is bound to an agent set; the profile-wide write stays for an unbound topic and
  keeps saying it is profile-wide.
  → Bound: `agentset().put({...boundSet, permissions})` + `saveState()` +
  `ctrl.perm.setTopic`. Unbound: `setPermission` + `writePatch` + `ctrl.perm.set`.
  The hint lines differ (`ctrl.perm.hintTopic` vs `ctrl.perm.hint`).
- [x] 3.2 The settings card shows the *effective* preset for the topic, which is
  the derived profile's row, not the base one.
  → `cmd-views.mjs` builds `permissions: { profile, preset }` from `presetOf(key)`
  and `settings-card.mjs` renders `settings.agent.permission` on the agent page.
- [x] 3.3 Test: two topics, different presets, two derived profiles, neither
  reading the other's row.
  → `test/permission-topics.test.mjs`.
- [x] 3.4 Only presets that can work without an approval channel are offered in
  a chat (`never`); a preset with `approval: ask` is listed with the reason it
  cannot be used yet, and becomes selectable when task 23 lands.
  → Listed with `ctrl.perm.needsApproval`; choosing one answers
  `ctrl.perm.cannotAsk` and touches nothing. Task 23 has not landed, so the
  "becomes selectable" half is still open by design.
- [x] 3.5 Measured evidence in the test's comment: the three experiments from
  `design.md` (sandbox row ignored, preset wins, root holds) — a future change
  that flips this must fail a test, not a user's turn.
  → `test/permission-rows.test.mjs` opens with the three experiments and a
  `SIBLING` case that fails if `sandboxModeOf` ever scans a sibling row again.

## 4. Bug reports that arrive as data

- [x] 4.1 `report.mjs`: collect version, platform, profile, model, chain arm, the
  turn's tail, tool names; redact tokens, keys, `Bearer`, home path.
  → `buildReport` adds node version, preset and cwd; the turn's tool names come
  from `handle-message.mjs` (`telemetry.toolNames`) and the last failure from
  `state.lastFailure[key]`.
- [x] 4.2 `/report` sends the bundle as a document to the owner's id, and in a
  group answers with the path only.
  → `control/cmd-bridge.mjs`: `toOwner` is the direct chat of
  `config.allowedUserIds[0]`; anything else gets `ctrl.report.pathOnly`.
- [x] 4.3 `test/report.test.mjs`: a fixture with a fake key and a home path comes
  out clean under `scan-secrets.mjs`'s own patterns.
  → 8 tests; the fixture's credentials are assembled from pieces so the repo's
  own pre-commit scan does not flag the test file.
- [x] 4.4 `docs/SUPPORT.md`: what to send, what never to send, and the one-line
  answer for "the bot went silent".

## 5. Say the truth in the docs

- [x] 5.1 README: a table of the three sandbox modes, what `workspaceRoot` means,
  and that `danger-full-access` is a deliberate choice per topic.
  → New section "The directory a topic writes in", including the three measured
  surprises and the note that stock installs are not permission-enabled.
- [x] 5.2 README: which attachment types become text, which become a path, and
  which need a transcriber — with the honest note that voice needs
  `faster-whisper` installed and is off by default.
- [x] 5.3 CHANGELOG: the behaviour change (a topic no longer writes the whole
  home directory) as the first line of the release.
- [x] 5.4 Release 1.25.0 after 1–4 are green.
