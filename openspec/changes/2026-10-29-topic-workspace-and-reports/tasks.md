# Tasks — topic workspace, per-topic permissions, bug reports

## 0. Write the two rows together, always

- [ ] 0.1 `patch-rows.mjs`: one `setPermission(patch, preset, workspaceRoot)` that
  writes `defaultPreset` **and** the `sandbox-policy` row (`mode` from the
  chosen preset, `workspaceRoot`), so the file cannot end up disagreeing with
  itself.
- [ ] 0.2 `test/patch-rows.test.mjs`: after a call, both rows name the same mode;
  a patch that had only one row gains the other.
- [ ] 0.3 Startup check: `defaultPreset` missing from the table is a refusal at
  boot with one line, not a turn that dies on its first tool call.
- [ ] 0.4 `/permissions` reads the *effective* preset from `defaultPreset` (today
  it reads the table and the table's current value — the same thing only
  because nobody edits the row by hand).

## 1. Make the boundary real before making it settable

- [ ] 1.1 `aset-profile.mjs`: accept `workspace` in a set; hash it into
  `derivedName`; write `sandbox-policy.workspaceRoot` in `overlayPatch`.
- [ ] 1.2 `profile-edit.mjs`: a `setRowConfig` path for
  `@deepseek-ai/dsh-sandbox-policy` → `config.workspaceRoot`, replacing the
  existing line rather than appending a second row.
- [ ] 1.3 `test/aset-profile.test.mjs`: a set with `workspace` produces a profile
  whose `workspaceRoot` is that directory and whose base row is unchanged.
- [ ] 1.4 Refuse the turn, not the profile, when the overlay for a *narrower*
  preset cannot be materialised: `turnProfileOf` returns an error, `handle-message`
  answers one line and does not spawn.

## 2. `/cd` that survives a real filesystem

- [ ] 2.1 Extract resolution into `control/cd-path.mjs`: pure `(input, {home, projectsDir, configCwd, isDir}) -> {path} | {error}`.
- [ ] 2.2 Table-driven test: drive letter, UNC, POSIX absolute, `~`, bare name,
  existing file (not a directory), missing path, `reset`.
- [ ] 2.3 `/cd` binds `workspaceRoot` to the same directory by default and says
  so in one line; `/cd <dir> wide` is the explicit escape hatch.
- [ ] 2.4 A bound directory that disappeared is reported as such instead of
  falling back to `config.cwd` (`turn.mjs:39`).

## 3. Per-topic permission preset

- [ ] 3.1 `/permissions` writes the topic's set (not the profile) when the topic
  is bound to an agent set; the profile-wide write stays for an unbound topic and
  keeps saying it is profile-wide.
- [ ] 3.2 The settings card shows the *effective* preset for the topic, which is
  the derived profile's row, not the base one.
- [ ] 3.3 Test: two topics, different presets, two derived profiles, neither
  reading the other's row.
- [ ] 3.4 Only presets that can work without an approval channel are offered in
  a chat (`never`); a preset with `approval: ask` is listed with the reason it
  cannot be used yet, and becomes selectable when task 23 lands.
- [ ] 3.5 Measured evidence in the test's comment: the three experiments from
  `design.md` (sandbox row ignored, preset wins, root holds) — a future change
  that flips this must fail a test, not a user's turn.

## 4. Bug reports that arrive as data

- [ ] 4.1 `report.mjs`: collect version, platform, profile, model, chain arm, the
  turn's tail, tool names; redact tokens, keys, `Bearer`, home path.
- [ ] 4.2 `/report` sends the bundle as a document to the owner's id, and in a
  group answers with the path only.
- [ ] 4.3 `test/report.test.mjs`: a fixture with a fake key and a home path comes
  out clean under `scan-secrets.mjs`'s own patterns.
- [ ] 4.4 `docs/SUPPORT.md`: what to send, what never to send, and the one-line
  answer for "the bot went silent".

## 5. Say the truth in the docs

- [ ] 5.1 README: a table of the three sandbox modes, what `workspaceRoot` means,
  and that `danger-full-access` is a deliberate choice per topic.
- [ ] 5.2 README: which attachment types become text, which become a path, and
  which need a transcriber — with the honest note that voice needs
  `faster-whisper` installed and is off by default.
- [ ] 5.3 CHANGELOG: the behaviour change (a topic no longer writes the whole
  home directory) as the first line of the release.
- [ ] 5.4 Release 1.25.0 after 1–4 are green.
