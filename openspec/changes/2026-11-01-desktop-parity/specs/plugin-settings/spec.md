# plugin-settings

## ADDED Requirements

### Requirement: A setting row is read from the plugin

The settings card SHALL draw a control only for a setting the plugin reports with
a key, a current value and a type.

#### Scenario: The plugin exposes a setting

- **WHEN** a plugin reports a boolean setting and its current value
- **THEN** the card draws one toggle whose label is the setting's own description

#### Scenario: The plugin reports nothing

- **WHEN** a plugin exposes no settings, or the settings cannot be read
- **THEN** the card says so and draws no control, because a switch for a value
  nobody returned is a switch that may do nothing

### Requirement: A write is read back before it is believed

After a change, the card SHALL re-read the value and SHALL show what the plugin
now holds.

#### Scenario: A value is written

- **WHEN** a toggle is pressed
- **THEN** the value is written, read back, and the card shows the value the
  plugin returned rather than the value that was requested

#### Scenario: The write does not stick

- **WHEN** the plugin returns the old value after a write
- **THEN** the card shows the old value and says the change was refused, instead
  of reporting success

### Requirement: Settings are per profile, not per install

A setting SHALL be written to the profile the topic runs, and SHALL NOT change
another profile's value.

#### Scenario: Two profiles

- **WHEN** a setting is changed in the headless profile
- **THEN** the same plugin in another profile keeps its own value

### Requirement: The card never shows a dead control

A control SHALL be drawn only when pressing it can change the value it shows.

#### Scenario: A read-only setting

- **WHEN** a setting is reported as read-only
- **THEN** it is shown as a value, not as a toggle

### Requirement: Three locales and an acknowledged press

Every label and answer SHALL exist in `en`, `ru` and `zh`, and a press SHALL be
acknowledged on the path a real tap takes.

#### Scenario: A Russian topic

- **WHEN** the card is rendered for a Russian topic
- **THEN** no raw key appears in its text or in a button label