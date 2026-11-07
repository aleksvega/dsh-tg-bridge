# memory-wiki

## ADDED Requirements

### Requirement: Facts route by their own words, never by classification

`/remember` SHALL route a fact by the literal prefix the person typed —
`project <name>:`, `user` (and its locale forms) — and SHALL place every fact
without a prefix into the Learned inbox of AGENTS.md, unchanged.

#### Scenario: A project fact

- **WHEN** the person sends `/remember project bridge: release on Friday`
- **THEN** the fact is appended under the `bridge` heading of PROJECTS.md, and
  the Learned inbox does not change

#### Scenario: A fact about the person

- **WHEN** the person sends `/remember user prefers metric units`
- **THEN** the fact is appended to USER.md with its date

#### Scenario: A plain fact

- **WHEN** the person sends `/remember the API rejects empty ids`
- **THEN** the fact lands in the Learned inbox exactly as before this change

### Requirement: The person can read and erase the whole memory

The memory commands SHALL expose every page from the chat: listing pages,
showing a page's tail, and erasing whole lines by word across the inbox,
USER.md and PROJECTS.md in one command.

#### Scenario: A word that lives in two files

- **WHEN** the person sends `/remember forget bridge` and the word appears in
  the inbox and in a PROJECTS.md section
- **THEN** both lines are erased and the answer names each file's count

#### Scenario: A word that lives nowhere

- **WHEN** the person sends `/remember forget <word>` and no page holds it
- **THEN** no file changes and the answer says nothing was found

### Requirement: Curation is a turn, and the bridge writes nothing during it

`/remember tidy` SHALL queue a real agent turn that reads the inbox and the
pages with its own tools, distributes and merges lines, and reports its moves
as the chat answer. The bridge itself SHALL NOT rewrite pages during tidy.

#### Scenario: The nightly run

- **WHEN** a schedule created with `/every` delivers the tidy prompt
- **THEN** the turn runs like any message in that topic and the chat receives
  the report

### Requirement: No silent injection of wiki pages

The bridge SHALL NOT append wiki pages to a turn's prompt or arguments. Pages
reach a session through the person's own commands (`/view`, `/find`, `/skills`)
or the tidy turn's tools.

#### Scenario: An ordinary turn in a topic with a full wiki

- **WHEN** any message starts a turn
- **THEN** the turn's arguments and prompt contain no page text beyond what
  AGENTS.md itself already carries

### Requirement: Writes never lose what surrounds them

Every write to a wiki page SHALL copy the previous version to `.bak` and land
by renaming a complete temp file into place, and SHALL move existing headings
and sections without rewriting them.

#### Scenario: A page gains a section

- **WHEN** a line is appended to a page that already has later sections
- **THEN** the later sections survive byte for byte and the `.bak` holds the
  previous version
