# quality-bar

## ADDED Requirements

### Requirement: Acceptance is one command

A change SHALL leave `node --test test/*.test.mjs` green, run from the repository
root with `DSH_HOME` unset, and SHALL NOT reach green by skipping, deleting or
weakening a test.

#### Scenario: A change makes an existing test fail

- **WHEN** a proposed change fails a test that predates it
- **THEN** the test is either shown to be wrong and corrected in the same commit
  with the reason in its own comment, or the change is redesigned; `.skip`,
  a deleted assertion and a narrowed expectation are not acceptance

#### Scenario: The suite is run from another directory

- **WHEN** the suite is started from a directory other than the repository root
- **THEN** it is restarted from the root, because a relative fixture path would
  otherwise test a copy nobody ships

### Requirement: A fix arrives with the test that fails without it

Every new or corrected behaviour SHALL be covered by a test that fails when the
change is reverted.

#### Scenario: A bug fix is proposed

- **WHEN** a fix is ready for review
- **THEN** the reviewer can name the test that fails on the previous revision,
  and the change records that failure

#### Scenario: The test passes on both revisions

- **WHEN** a test passes before and after the change
- **THEN** it is not the test for that change, and the change is not yet covered

### Requirement: Every new string exists in all three locales

A user-visible string SHALL be added to `en`, `ru` and `zh` in the same commit,
and read from the topic's language rather than the install's.

#### Scenario: A key reaches one locale only

- **WHEN** a key exists in one locale and not in another
- **THEN** the i18n parity test fails and names the missing key

#### Scenario: The last consumer of a key is removed

- **WHEN** a control stops using a string
- **THEN** the key is removed from all three locales in the same commit, because a
  key nothing reads is a promise the code no longer keeps

### Requirement: A control the chat cannot keep is not drawn

Every inline button SHALL carry a payload Telegram accepts, and every control the
card draws SHALL reach its handler through the export the runtime calls.

#### Scenario: A card draws a non-pressable label

- **WHEN** a card draws a heading or separator as an inline button with no
  callback data
- **THEN** the keyboard conversion drops it and a test fails, because the message
  would otherwise arrive without the rows that explain its buttons

#### Scenario: A card's handler is tested only where it is defined

- **WHEN** a card exports a router that supplies its handler's dependencies
- **THEN** a test calls that router, not only the handler with the dependencies
  passed in by hand, and asserts the press is claimed, acknowledged and answered

### Requirement: No new dependency and no module over the ceiling

A change SHALL NOT add a runtime dependency and SHALL keep every module in
`package.json.files[]` at or under 500 lines.

#### Scenario: A feature seems to need a library

- **WHEN** a change would require a runtime dependency
- **THEN** it is implemented with the standard library or refused;
  `package.json.dependencies` stays empty

#### Scenario: A module crosses the ceiling

- **WHEN** a shipped module exceeds 500 lines
- **THEN** `test/module-size.test.mjs` fails and the split happens in the same
  change

### Requirement: A claim is measured, not asserted

A statement about a provider, a path or a platform SHALL record the observation
that supports it, and the test SHALL assert the behaviour rather than the
network.

#### Scenario: A provider is declared working

- **WHEN** a change states that a route answers
- **THEN** the change records the status code and the latency observed, on the
  date it was observed

#### Scenario: A test would need the internet

- **WHEN** the behaviour depends on a remote service
- **THEN** the transport is stubbed and the test asserts what the code does with
  a given answer, so the suite stays runnable offline

### Requirement: An untested rule says so

A requirement that is enforced by review rather than by a test SHALL name itself
as such.

#### Scenario: A rule has no test

- **WHEN** a requirement cannot be asserted by a test
- **THEN** its scenario states that it is a review rule, so the untested part of
  the bar is visible instead of assumed