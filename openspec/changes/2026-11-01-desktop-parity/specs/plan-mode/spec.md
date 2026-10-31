# plan-mode

## ADDED Requirements

### Requirement: Plan mode is a per-topic state

`/plan` SHALL turn plan mode on or off for the current topic, SHALL report the
state, and SHALL keep it across a restart.

#### Scenario: Plan mode is turned on

- **WHEN** a person sends `/plan` in a topic
- **THEN** the answer says plan mode is on for this topic, and a later turn in the
  same topic is asked for a plan rather than for work

#### Scenario: Another topic is unaffected

- **WHEN** plan mode is on in one topic
- **THEN** a turn in a neighbouring topic runs normally

### Requirement: A plan turn performs no write

A turn in plan mode SHALL NOT change a file, and the answer SHALL be the plan
itself.

#### Scenario: The model tries to edit

- **WHEN** a plan-mode turn calls a writing tool
- **THEN** the call is refused before it reaches the disk and the refusal is part
  of the plan conversation, not a dead turn

#### Scenario: The plan arrives

- **WHEN** the plan-mode turn ends
- **THEN** the topic receives the plan and a card with **Approve** and **Keep
  planning**

### Requirement: The card decides the next turn

**Approve** SHALL release the same turn to act, and **Keep planning** SHALL ask
for a revision without leaving plan mode.

#### Scenario: Approve is pressed

- **WHEN** the person presses Approve
- **THEN** the same request is run with plan mode off for that turn, and the
  result appears in the same topic

#### Scenario: Keep planning is pressed

- **WHEN** the person presses Keep planning
- **THEN** the model is asked to revise, plan mode stays on, and no tool writes

#### Scenario: The card is stale

- **WHEN** a press arrives for a plan that is no longer the topic's current plan
- **THEN** nothing is executed and the answer says the plan changed

### Requirement: The card says what it can promise

The card SHALL state whether the guarantee is the sandbox's or the model's.

#### Scenario: The sandbox cannot enforce the mode

- **WHEN** the topic's permission preset does not enforce read-only
- **THEN** the card says the mode is the model's promise rather than a sandbox
  rule, so the person is not told a turn cannot write when it can

### Requirement: Three locales and an acknowledged press

Every label and answer SHALL exist in `en`, `ru` and `zh`, and a press SHALL be
acknowledged on the path a real tap takes.

#### Scenario: A Russian topic

- **WHEN** the card is rendered for a Russian topic
- **THEN** no raw key appears in its text or in a button label