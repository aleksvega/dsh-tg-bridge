# file-edit

## ADDED Requirements

### Requirement: Preview before a write

`/edit <path>` SHALL show the diff it would make and SHALL NOT write until the
person presses **Применить**.

#### Scenario: A confirmed edit

- **WHEN** the person sends the old text, then the new text, then presses
  **Применить**
- **THEN** the file holds the new text and the written bytes equal what the preview
  showed

#### Scenario: A cancelled edit

- **WHEN** the person presses **Отмена**
- **THEN** the file is unchanged and the card says nothing was written

### Requirement: An exact replacement, refused when ambiguous

The edit SHALL replace exactly one occurrence of the old text. Zero matches and
several matches SHALL each be refused with the count, and the file SHALL be left
untouched.

#### Scenario: The text appears three times

- **WHEN** the old text occurs three times in the file
- **THEN** the answer says three and asks for more context, and nothing is written

### Requirement: A write is revertible from /diff

Every applied edit SHALL record a hunk the existing diff revert can undo.

#### Scenario: Undoing an edit

- **WHEN** the person opens `/diff` after an edit and presses revert on that hunk
- **THEN** the file returns to its previous bytes

### Requirement: The file must not change underneath the preview

If the file changes between the preview and the confirm, the write SHALL be
refused and the preview re-offered.

#### Scenario: An edit lands under a preview

- **WHEN** another turn writes the file after the preview was drawn
- **THEN** the confirm press answers that the file changed and writes nothing

### Requirement: Three locales

Both buttons, the diff header and every refusal SHALL exist in `en`, `ru` and
`zh`.

#### Scenario: A Russian topic

- **WHEN** the preview and its buttons are drawn for a Russian topic
- **THEN** both buttons and the refusal sentences are translated