# file-browse

## ADDED Requirements

### Requirement: One folder at a time, as buttons

`/ls [path]` SHALL list exactly one directory: folders first, then files, each as
a button, in pages of twenty.

#### Scenario: A folder with more entries than fit

- **WHEN** a folder holds forty entries
- **THEN** the card shows twenty and a button that opens the next twenty

#### Scenario: A path with a space

- **WHEN** the folder name contains a space
- **THEN** the listing opens and its buttons round-trip the name unchanged

### Requirement: A file opens as a preview

A file button SHALL open the first forty lines of that file as its own message,
with a **more** button while lines remain.

#### Scenario: Extending a preview

- **WHEN** the person presses **more** on a preview
- **THEN** the message holds the next forty lines and the button remains while more
  remain

### Requirement: The fence is the topic's workspace

A listing or preview SHALL NOT leave the topic's workspace unless the person typed
an absolute path, and SHALL refuse a binary file and a file over the size cap with
the reason in one sentence.

#### Scenario: A path outside the workspace

- **WHEN** the person asks for a relative path that escapes the workspace
- **THEN** the answer names the workspace and lists nothing

#### Scenario: A binary file

- **WHEN** a file is not text
- **THEN** the answer says so and offers `/send`

### Requirement: Three locales

Every label, page note and refusal SHALL exist in `en`, `ru` and `zh`.

#### Scenario: A Russian topic
- **WHEN** the card is drawn for a Russian topic
- **THEN** no raw key appears on it