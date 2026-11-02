# error-reports

## ADDED Requirements

### Requirement: A report is a file

`/report` SHALL produce a single file containing the bridge version, host
version, platform, profile, model, the failing turn's tail and the names of the
tools it called, and SHALL send it as a document.

#### Scenario: A stranger reports a failure

- **WHEN** a non-owner sends `/report` after a failed turn
- **THEN** the file is sent to the owner's id and the stranger is told it was
  delivered, with no copy of the file left in their chat

#### Scenario: No failure to report

- **WHEN** `/report` is sent and the last turn succeeded
- **THEN** the answer says so and offers the last turn's statistics instead of
  an empty file

### Requirement: A report carries no secret and no home path

The report SHALL be redacted before it is written: token, any `*_API_KEY`
value, `Bearer` credentials and the home directory replaced.

#### Scenario: A key appears in the log tail

- **WHEN** the tail contains an API key or a bearer token
- **THEN** the written file contains a placeholder in its place, and the same
  scan that guards a release (`scan-secrets.mjs`) finds nothing in the fixture

#### Scenario: Tool arguments

- **WHEN** a turn called a tool with a file's contents as an argument
- **THEN** the report names the tool and the path only; the contents are not
  included

### Requirement: The owner can read a report without the chat

The report SHALL be readable as text and SHALL carry the bridge version first,
so a report from an old release is recognisable before anything else.

#### Scenario: An old report arrives

- **WHEN** a report names a version older than the running one
- **THEN** the owner sees the version on the first line and can ask for an
  update before reading further
