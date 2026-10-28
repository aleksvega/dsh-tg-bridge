# module-structure Specification

## Purpose

Keep every shipped module readable in one sitting: a 500-line ceiling enforced
by `test/module-size.test.mjs`, an acyclic import graph, and a `files[]` list
that always matches what the runtime imports. The rules exist because the two
worst bugs of 1.19.x lived in files nobody could read whole, and they are
asserted by tests rather than by review.

## Requirements

### Requirement: Source module size

Every shipped source module SHALL be at most 500 lines, counted as physical
lines of the file.

#### Scenario: A module grows past the ceiling

- **WHEN** a module listed in `package.json.files[]` exceeds 500 lines
- **THEN** `test/module-size.test.mjs` fails and names the file and its line count

#### Scenario: No file is exempt

- **WHEN** any module listed in `package.json.files[]` exceeds 500 lines
- **THEN** `test/module-size.test.mjs` fails and names the file and its line
  count; the `MIGRATION` set that once carried the not-yet-split files is empty,
  so the failure cannot be waived without editing the test in the same commit

#### Scenario: A new module is added

- **WHEN** a new `.mjs` is added and listed in `files[]`
- **THEN** it is subject to the same ceiling from its first commit

### Requirement: Acyclic imports

The shipped module graph SHALL contain no import cycle.

#### Scenario: A cycle is introduced

- **WHEN** module A imports B and B imports A, directly or through a chain
- **THEN** `test/import-cycles.test.mjs` fails and prints the cycle path

### Requirement: Behaviour is unchanged by a move

A refactoring step SHALL NOT change observable behaviour.

#### Scenario: A step lands

- **WHEN** a step's commit is applied
- **THEN** `node --test` passes without a single test being weakened, and the
  CHANGELOG line for the release says "no behaviour change"

#### Scenario: A test imports a moved symbol through the old module

- **WHEN** a test keeps importing a symbol from the module it was moved out of
- **THEN** the test is repointed at the new module in the same commit, so the
  coverage follows the code

### Requirement: The published file set stays complete

Every module that is imported at runtime SHALL be listed in `package.json.files[]`
and copied by `sync-runtime.mjs`.

#### Scenario: A new module is imported but not shipped

- **WHEN** a runtime import resolves to a file absent from `files[]`
- **THEN** `test/package-files.test.mjs` fails

#### Scenario: A runtime sync is performed after a step

- **WHEN** `node sync-runtime.mjs` runs into a scratch root
- **THEN** the copied tree contains every new module and the bridge boots from it

### Requirement: Translation parity

Splitting the dictionaries SHALL preserve key parity across locales.

#### Scenario: A key is lost during a split

- **WHEN** one locale is missing a key the others have
- **THEN** the existing i18n parity test fails

### Requirement: Command dispatch stays inspectable

The command dispatcher SHALL resolve a command to one exported handler per
command group, not to a branch inside a single function.

#### Scenario: A command is added

- **WHEN** a developer adds a command
- **THEN** they add a handler to one group module and one entry to the registry,
  and the release waits for nothing else

#### Scenario: The Telegram menu is regenerated

- **WHEN** the command list moves into `control/registry.mjs`
- **THEN** `bot-menu.mjs` still produces the same command set, verified with
  `getMyCommands` on both scopes
