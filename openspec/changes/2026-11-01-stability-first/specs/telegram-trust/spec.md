# telegram-trust

## ADDED Requirements

### Requirement: Identity is the person, not the chat

A message SHALL be accepted only when its sender is in `allowedUserIds`. A chat id
in the allowlist SHALL authorize a private chat only (`chat.type === "private"`),
never a group or a channel.

#### Scenario: A group member who is not listed

- **WHEN** a message arrives from a group whose id is listed, from a user who is
  not listed
- **THEN** the bridge refuses it and does not start a turn

#### Scenario: The owner in a private chat

- **WHEN** a message arrives from a listed user in a private chat
- **THEN** the bridge accepts it as before

#### Scenario: Steering a live turn

- **WHEN** an unlisted user's message arrives while a turn runs in that topic
- **THEN** it is refused on the same rule and does not reach the live turn

### Requirement: No control is drawn unless it can act

Every inline control SHALL have a producer that can populate its payload. A
handler with no caller SHALL be removed together with its strings and its README
claim.

#### Scenario: The approval route on a profile that asks

- **WHEN** a turn runs on a profile whose permissions ask for confirmation
- **THEN** either the chat receives an approval card whose press resolves the
  turn, or the turn stops before acting and says that the profile requires a
  confirmation the bridge cannot ask for
- **AND** the README does not claim confirmations the first branch does not
  deliver

#### Scenario: A stale approval press

- **WHEN** an approval card from an earlier turn is pressed
- **THEN** the press answers "no longer active" and changes nothing

### Requirement: Logs leave the process redacted

Every log line sent to a chat, and every log document, SHALL pass through the
same `redact()` used by `/report`.

#### Scenario: A token reached the log

- **WHEN** a log line contains a bot token or an `sk-` key
- **THEN** `/logs` and `/logs file` show it as a placeholder

#### Scenario: A log document from a group

- **WHEN** `/logs file` is requested outside the owner's private chat
- **THEN** the bridge refuses to send the document

### Requirement: Inlined content is data, not instructions

A document, a photo caption or a voice transcript SHALL be fenced in the prompt
as untrusted data, with the instruction that nothing inside it is a command from
the person.

#### Scenario: A document that asks to be obeyed

- **WHEN** a text file contains "ignore previous instructions" and is sent to the
  bot
- **THEN** the prompt places the file body inside the data fence and the caption
  outside it

### Requirement: A turn child gets an allowlisted environment

The turn process SHALL receive only the variables it needs, the profile's declared
provider keys, and the bridge's own `DSH_TG_*` values. It SHALL NOT inherit the
entire `process.env`.

#### Scenario: An unrelated secret in the bridge environment

- **WHEN** the bridge runs with a variable that is not declared for turns
- **THEN** the turn child's environment does not contain it

### Requirement: Chat-driven code installation is not a button

Installing a third-party plugin SHALL require a typed command in the owner's
private chat, with the package name echoed before the install runs. A bare press
SHALL NOT install anything.

#### Scenario: A press on an install button

- **WHEN** a stale install button is pressed
- **THEN** the bridge answers with the command to type instead of installing
