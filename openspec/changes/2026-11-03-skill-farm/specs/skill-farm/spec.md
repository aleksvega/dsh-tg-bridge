# skill-farm

## ADDED Requirements

### Requirement: A skill is born from a proposal the person has read

`/skills gather` SHALL queue an agent turn that reads the recent sessions of
the project and proposes one skill as its chat answer. The bridge SHALL NOT
write any skill file as part of gather.

#### Scenario: Gather in a topic with history

- **WHEN** the person sends `/skills gather` and the queue path is available
- **THEN** one turn is queued for that topic and its prompt asks for exactly
  one skill proposal

#### Scenario: Gather with no turn path

- **WHEN** the command runs where no turn can be queued
- **THEN** the answer refuses in one sentence and nothing is written

### Requirement: Adopt writes what the person approved

`/skills adopt` SHALL write the skill to `~/.dsh/skills/<name>/SKILL.md` using
the proposal the gather turn answered with, or the text of the reply that
followed it when the person edited it, and SHALL apply the backup-and-rename
write discipline.

#### Scenario: Adopt the last proposal

- **WHEN** a gather turn has answered in the topic and the person sends
  `/skills adopt`
- **THEN** the SKILL.md on disk matches the proposal text and the previous
  version, if any, is in `.bak`

#### Scenario: Adopt an edited proposal

- **WHEN** the person replies to the proposal with changes and sends
  `/skills adopt <name>` quoting that reply
- **THEN** the file body is the reply's text

#### Scenario: Adopt with nothing to adopt

- **WHEN** no gather proposal exists in the topic
- **THEN** the answer says so in one sentence and no file is written

### Requirement: Retire archives, never deletes

`/skills retire <name>` SHALL move the skill directory to
`~/.dsh/skills-archive/` with a provenance line, and SHALL NOT delete history.

#### Scenario: Retire a live skill

- **WHEN** the skill exists in the catalog
- **THEN** it is gone from `~/.dsh/skills`, present under the archive root,
  and the answer names the archive

#### Scenario: Retire a name already archived

- **WHEN** the archive root already holds that name
- **THEN** the incoming directory is stored under a dated name and nothing is
  overwritten

### Requirement: The catalog answers for its size

`/skills` SHALL list every skill with its line count and last-modified date,
and SHALL flag the catalog against the 25-skill cap.

#### Scenario: The catalog is over the cap

- **WHEN** `~/.dsh/skills` holds more than 25 skills
- **THEN** the listing carries one line naming the count and the cap

### Requirement: No third-party door opens

The gather/adopt flow SHALL NOT install skills from outside the machine, and
SHALL NOT touch the security-scan rule that governs third-party skills.

#### Scenario: Adopt names an outside source

- **WHEN** the adopted text names a repository or an install URL as its source
- **THEN** the write proceeds only as plain local text; no fetch and no
  install happens
