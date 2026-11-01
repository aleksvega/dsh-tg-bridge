# chat-search

## ADDED Requirements

### Requirement: A literal search, not a regular expression

`/find <text> [path]` SHALL match the text literally, so a query containing `.`,
`*`, `(` or `\` searches for those characters and does not throw.

#### Scenario: A query with a dot

- **WHEN** the person searches for `v1.38`
- **THEN** the answer contains the lines holding `v1.38` and the command does not
  fail on the dot

### Requirement: Results are bounded and say so

The search SHALL stop at twenty rows and at a walk bound, and SHALL report both
how many matches exist and whether the walk stopped early.

#### Scenario: More matches than the cap

- **WHEN** a string appears in two hundred places
- **THEN** the answer shows twenty, says how many were found and how to narrow it

#### Scenario: No matches

- **WHEN** nothing matches
- **THEN** the answer is one sentence naming the folder searched, not an empty
  message and not a card with no rows

### Requirement: A skipped file is counted, not read

A file the fence refuses SHALL be skipped without being read, and the answer SHALL
name how many were skipped.

#### Scenario: A workspace with a large binary

- **WHEN** the walk meets a binary larger than the cap
- **THEN** it is skipped, and the answer says one file was skipped

### Requirement: A result opens where it matched

A result row SHALL be a button that opens that file at that line through the
preview from `file-browse`.

#### Scenario: Opening a result

- **WHEN** the person presses a result
- **THEN** the preview opens with the matching line inside the shown range and
  marked

### Requirement: Three locales

The header, the skips note, the cap note and every refusal SHALL exist in `en`,
`ru` and `zh`.

#### Scenario: A Chinese topic

- **WHEN** the answer is drawn for a Chinese topic
- **THEN** the header, the skips note and the cap note are translated