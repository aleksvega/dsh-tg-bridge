# topic-workspace

## ADDED Requirements

### Requirement: The two permission rows agree

A profile the bridge writes SHALL carry the same mode in `defaultPreset`'s entry
and in the `sandbox-policy` row, because the permission table decides what a turn
runs under and the sandbox row is otherwise a comment that lies.

#### Scenario: A preset is applied

- **WHEN** the bridge writes a permission preset into a profile
- **THEN** `defaultPreset` names that preset, the preset's `sandbox` equals the
  `sandbox-policy.mode` line, and a test asserts both

#### Scenario: Only one row is present

- **WHEN** a profile has a permission table but no `sandbox-policy` row, or the
  reverse
- **THEN** the bridge writes the missing row in the same edit, so the file never
  describes two different policies

### Requirement: A bound topic writes only its own directory

A turn whose topic is bound to a directory SHALL run under a `workspaceRoot`
equal to that directory, so the host's own sandbox — not a prompt — is what
stops it.

#### Scenario: A turn reaches for a neighbouring project

- **WHEN** a topic is bound to `Projects/latin-bot` with the `workspace-write`
  preset and the model writes `Projects/game/notes.md`
- **THEN** the write is refused by the host sandbox and the refusal is shown in
  the chat as a permission line, not as a crash

#### Scenario: The topic is bound to its own project

- **WHEN** the same topic writes `Projects/latin-bot/notes.md`
- **THEN** the write succeeds without a prompt

#### Scenario: No topic is bound

- **WHEN** a topic has no bound directory
- **THEN** it runs under the install default and the chat says so when the
  default is wider than the topic's own directory

### Requirement: A preset is chosen per topic

The permission preset SHALL be a property of the topic, materialised into a
derived profile, so one topic changing it does not change another.

#### Scenario: Two topics, two presets

- **WHEN** topic A is set to `read-only` and topic B to `workspace-write`
- **THEN** each runs under its own derived profile and neither reads the other's
  `defaultPreset`

#### Scenario: The derived profile cannot be written

- **WHEN** materialising the derived profile for a narrower preset fails
- **THEN** the turn is refused with one line naming the preset it could not
  apply; it SHALL NOT run under the wider base preset

### Requirement: `/cd` resolves a path the same way on every platform

`/cd` SHALL accept a Windows drive path, a UNC path, a POSIX absolute path, a
`~`-relative path and a bare project name, and SHALL reject a path that is not a
directory with one line naming what was tried.

#### Scenario: A bare name

- **WHEN** the person types `/cd my-app` and `~/Projects/my-app` exists
- **THEN** the topic is bound to that directory

#### Scenario: An existing file

- **WHEN** the person types `/cd README.md` and that path is a file
- **THEN** the answer says it is not a directory and the binding does not change

#### Scenario: A directory that later disappears

- **WHEN** a bound directory is deleted and the next turn starts
- **THEN** the turn refuses with one line naming the missing directory; it SHALL
  NOT silently fall back to the install default

### Requirement: A permission refusal reads as a refusal

A sandbox denial SHALL be presented as a permission answer with the one action
that would allow it, never as a generic turn failure.

#### Scenario: The sandbox denies a write

- **WHEN** the host refuses a write because of the preset
- **THEN** the chat shows which path was refused and which preset refused it,
  with a button that opens the preset choice for this topic

### Requirement: An unusable preset is not offered as a choice

A preset whose `approval` is `ask` SHALL NOT be presented as selectable in a
chat until a turn can put the approval question in front of the person, because
a headless turn fails closed and the choice would read as a lie.

#### Scenario: `ask` is listed but not offered

- **WHEN** the permission table contains a preset with `approval: ask`
- **THEN** `/permissions` lists it with the reason it cannot be used yet, and
  refuses to set it

#### Scenario: The approval channel exists

- **WHEN** a turn can ask the person through a chat button
- **THEN** `ask` presets become selectable, and the refusal above is removed in
  the same change that adds the button
