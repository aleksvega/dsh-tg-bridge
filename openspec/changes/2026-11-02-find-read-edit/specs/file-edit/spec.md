# file-edit

## ADDED Requirements

### Requirement: Preview before a write

`/edit <path>:<line>` or `/edit <path>:<from>-<to>` SHALL show the lines it will
replace, take the replacement as the next plain message in the topic, then show
the diff it would make. It SHALL NOT write until the person presses **Применить**.

#### Scenario: A confirmed edit

- **WHEN** the person names the lines, sends the replacement text, then presses
  **Применить**
- **THEN** the file holds the new lines and the written bytes equal what the
  preview showed

#### Scenario: A cancelled edit

- **WHEN** the person presses **Отмена**
- **THEN** the file is unchanged and the card says nothing was written

#### Scenario: Deleting lines

- **WHEN** the replacement message is a single dash
- **THEN** the named lines are removed and no dash is written

### Requirement: Lines, not a text match

The edit SHALL address lines by number rather than matching text, so an
ambiguous replacement cannot happen: the person says exactly which lines change.

A range past the end of the file SHALL be refused with the file's real length,
and the trailing newline of the file SHALL be preserved as it was.

#### Scenario: A range past the end

- **WHEN** the person asks for lines 5–9 of a two-line file
- **THEN** the answer names the real length and nothing is written

#### Scenario: A file without a final newline

- **WHEN** the file does not end with a newline and an edit is applied
- **THEN** the result still does not end with one

### Requirement: A write is revertible from /diff

Every applied edit SHALL record a hunk the existing diff revert can undo, and
the confirmation SHALL say so in the same sentence.

#### Scenario: Undoing an edit

- **WHEN** the person opens `/diff` after an edit and presses revert on that hunk
- **THEN** the file returns to its previous bytes

### Requirement: The file must not change underneath the preview

If the named lines no longer match what the preview showed, the write SHALL be
refused, the pending edit forgotten, and the person told to run `/edit` again.

#### Scenario: An edit lands under a preview

- **WHEN** another turn writes those lines after the preview was drawn
- **THEN** the confirm press answers that the file changed and writes nothing

### Requirement: The fence covers writing too

A write SHALL go through the same fence as a read: nothing outside the topic
folder, never a directory, never a file that would grow past 512 KB, and never
a new file — an edit to a file that disappeared is a refusal.

#### Scenario: A file removed before the press

- **WHEN** the file is deleted between the preview and **Применить**
- **THEN** the answer says the file is gone and nothing is created

### Requirement: Three locales

Both buttons, the diff header and every refusal SHALL exist in `en`, `ru` and
`zh`.

#### Scenario: A Russian topic

- **WHEN** the preview and its buttons are drawn for a Russian topic
- **THEN** both buttons and the refusal sentences are translated
