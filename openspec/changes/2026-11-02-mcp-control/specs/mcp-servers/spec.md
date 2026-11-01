# mcp-servers

## ADDED Requirements

### Requirement: The card reports the profile, not a second copy

`/mcp` SHALL read the MCP servers from the topic profile's own
`cordis.patch.yml`, so the list cannot disagree with what the host loads.

#### Scenario: The profile runs one server

- **WHEN** the profile holds one `mcp-client` entry
- **THEN** the card lists it with its server name and transport, and the entry is
  derivable from the file alone

#### Scenario: The profile holds none

- **WHEN** the profile has no `mcp-client` entry
- **THEN** the card says so in one sentence and offers `/mcp add`

### Requirement: Secrets are redacted everywhere

A header value, a token inside a URL and an environment value SHALL render as
`***` in every view and in every answer, including a refusal.

#### Scenario: A server with a token in its URL

- **WHEN** the entry's URL carries `?key=abc123`
- **THEN** the card shows `?key=***` and the rest of the URL unchanged

### Requirement: Adding is previewed and refused when duplicated

`/mcp add` SHALL show the YAML it will insert and SHALL write only after a confirm
press. A server name that already exists SHALL be refused with that name.

#### Scenario: A duplicate name

- **WHEN** the person adds `exa` while `exa` is already configured
- **THEN** nothing is written and the answer names the existing entry

#### Scenario: An unparsable profile

- **WHEN** the profile file does not parse
- **THEN** the write is refused with the reason and the file is left byte-identical

### Requirement: Removal touches only what the chat added

`/mcp rm` SHALL remove only an entry the chat itself added; a pre-existing entry
SHALL be refused and pointed at the file.

#### Scenario: Removing a hand-written server

- **WHEN** the person removes a server that was in the profile before the chat
  ever touched it
- **THEN** nothing is removed and the answer names the file to edit

### Requirement: A write is not a running server

After a write the card SHALL say a restart is needed and SHALL NOT claim the
server is running.

#### Scenario: Right after an add

- **WHEN** the add is written
- **THEN** the answer says the host must restart before the server can answer, and
  offers no "running" state

### Requirement: Three locales

Every label, refusal and hint SHALL exist in `en`, `ru` and `zh`.

#### Scenario: A Russian topic

- **WHEN** the card and its confirmations are drawn for a Russian topic
- **THEN** every label, refusal and hint is translated