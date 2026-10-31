# subagent-panel

## ADDED Requirements

### Requirement: A running turn shows one row per subagent

While a turn runs, the bridge SHALL show a panel with one row per subagent: what
it was asked, how long it has run, and its tokens when known.

#### Scenario: A turn starts a subagent

- **WHEN** the turn reports a subagent starting
- **THEN** the panel gains a row naming the task rather than an internal id

#### Scenario: The turn ends

- **WHEN** the turn ends, successfully or not
- **THEN** the panel is removed or replaced by the turn card, and nothing is left
  that looks like a running subagent

### Requirement: Updates are throttled

The panel SHALL be edited on a throttle, not on every event.

#### Scenario: A fast turn

- **WHEN** a turn produces many subagent events within one window
- **THEN** the panel is edited at most once per window, so the bot does not hit a
  rate limit

#### Scenario: Nothing changes

- **WHEN** no value in the panel would change
- **THEN** no edit is made

### Requirement: The panel never blocks the turn

A failed edit SHALL be ignored, and SHALL NOT fail or delay the turn.

#### Scenario: The edit is refused

- **WHEN** Telegram rejects an edit to the panel
- **THEN** the failure is one log line and the turn continues

### Requirement: A row carries no secret and no private path

A row SHALL name the task and its numbers only, never a prompt body or a path
outside the workspace.

#### Scenario: A subagent reads a file

- **WHEN** a subagent's task mentions a file
- **THEN** the row shows the workspace-relative path or no path at all

### Requirement: Three locales

Every label and unit SHALL exist in `en`, `ru` and `zh`.

#### Scenario: A Russian topic

- **WHEN** the panel is rendered for a Russian topic
- **THEN** no raw key appears in it