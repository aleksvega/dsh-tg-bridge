# updatable-install

## ADDED Requirements

### Requirement: State and config carry a version

`state.json` and `config.json` SHALL contain an integer `version`. On load, a
migration ladder SHALL bring an older file to the current version exactly once,
before any write.

#### Scenario: A file written by the previous release

- **WHEN** a `state.json` without `version` is loaded
- **THEN** it is upgraded in memory, sessions and topic bindings are preserved,
  and the next save writes the current version

#### Scenario: A file from a newer release

- **WHEN** `state.json` names a version newer than this build
- **THEN** the bridge refuses to write it, says which version it found, and starts
  read-only rather than downgrading the file

### Requirement: A backup exists before the first write under a new version

Before saving state migrated from an older version, the bridge SHALL copy the
original to `state.json.bak` (and `config.json.bak` for config).

#### Scenario: The migration itself is wrong

- **WHEN** a migration throws before the first save
- **THEN** the original files are untouched on disk

### Requirement: A release is verified before it is promoted

`installRelease` SHALL stage the new release, run the install check on the staged
copy, and only then copy it over the root.

#### Scenario: The staged copy fails the check

- **WHEN** an import in the staged release does not resolve
- **THEN** the root is not touched and the person is told the release is broken

#### Scenario: The process dies mid-promote

- **WHEN** the bridge stops between staging and the final copy
- **THEN** the next start finds the previous install intact and usable

### Requirement: Local drift is detected, not overwritten silently

The install SHALL record a hash of every shipped file. On update, a file whose
hash differs SHALL be reported before it is replaced.

#### Scenario: A hand-patched file

- **WHEN** the person edited a shipped file and then updates
- **THEN** the update names the changed files and asks for a typed confirmation
  before replacing them

### Requirement: Backups do not grow without bound

`update-backup-*` directories SHALL be pruned to the three newest after a
successful turn on the new version.

#### Scenario: The sixth update

- **WHEN** a sixth backup is created
- **THEN** the three newest remain and the older ones are removed

### Requirement: An update is refused while a turn runs

`/update confirm` SHALL refuse when any topic has an active turn, and SHALL say
which topic is busy.

#### Scenario: A turn is running in another topic

- **WHEN** the owner confirms an update while a turn is active
- **THEN** nothing is replaced and the answer names the busy topic

### Requirement: An unproven release is not a rollback target

A version that has not completed one successful turn SHALL NOT be chosen as the
rollback target, and SHALL be marked proven only after such a turn.

#### Scenario: Two faults on the new version

- **WHEN** a release installed minutes ago faults twice
- **THEN** the rollback goes to the last proven version, not to the unproven one

### Requirement: A restart names the topics it interrupted

Every restart path — `/restart`, an update, a rollback — SHALL notify each topic
whose turn was interrupted with one line in that topic.

#### Scenario: A rollback while a turn runs

- **WHEN** a rollback restarts the bridge during a turn
- **THEN** that topic receives the interruption line and its card reaches a
  terminal state
