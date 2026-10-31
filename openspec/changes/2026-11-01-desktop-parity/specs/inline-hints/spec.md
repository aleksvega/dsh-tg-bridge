# inline-hints

## ADDED Requirements

### Requirement: A prefix suggests commands with their parameters

Inline mode SHALL answer `@bot <prefix>` with the commands whose name starts with
the prefix, up to twenty, each with its usage line.

#### Scenario: A prefix matches

- **WHEN** a person types `@bot rew` in any chat
- **THEN** the results include `rewind` with its usage line, and choosing one
  inserts `rewind ` without sending it

#### Scenario: Nothing matches

- **WHEN** the prefix matches no command
- **THEN** the answer is the command hub rather than an empty list

#### Scenario: The prefix is empty

- **WHEN** the person types only the bot's name
- **THEN** the most used commands are offered, in the topic's language

### Requirement: Inline mode executes nothing

An inline result SHALL only insert text; it SHALL NOT run a command or a turn.

#### Scenario: A result is chosen

- **WHEN** a person taps an inline result
- **THEN** the text is placed in their input box and nothing is sent or executed

### Requirement: A suggestion carries no chat content

The inline answer SHALL be built from the command registry and the topic's
language only, never from the conversation, the state or a file.

#### Scenario: A stranger uses the bot inline

- **WHEN** someone with no access to the install types an inline query
- **THEN** they receive the command list and nothing about any chat, and the
  answer is the same for every requester

### Requirement: Three locales

The usage lines offered inline SHALL be the same strings `/help` shows, in `en`,
`ru` and `zh`, in the language of the chat the query came from.

#### Scenario: A Russian chat

- **WHEN** an inline query arrives from a Russian chat
- **THEN** names, usage and descriptions are Russian, with no raw key