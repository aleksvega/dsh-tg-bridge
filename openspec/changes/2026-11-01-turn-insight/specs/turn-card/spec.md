# turn-card

## ADDED Requirements

### Requirement: A turn ends with a card, not a paragraph

The bridge SHALL send a small card after a turn, showing the blocks the person
selected.

#### Scenario: A successful turn

- **WHEN** a turn ends
- **THEN** the topic receives a card with the selected blocks, in the topic's
  language, separate from the answer so the answer stays readable

### Requirement: Blocks are chosen per topic and remembered

The person SHALL be able to choose which blocks appear, the choice SHALL be
stored per topic, and SHALL survive a restart.

#### Scenario: A block is turned off

- **WHEN** the person turns off the token block for a topic
- **THEN** the next card in that topic omits it and a neighbouring topic keeps its
  own choice

### Requirement: An unmeasured value is named, not zeroed

A block whose value is unknown SHALL say so, and SHALL NOT render a zero.

#### Scenario: The provider reports no cost

- **WHEN** a turn's cost is unknown
- **THEN** the card says the cost is unknown rather than showing `$0.00`

#### Scenario: The balance cannot be read

- **WHEN** the balance is unavailable
- **THEN** the balance line is omitted and the rest of the card is drawn

### Requirement: Three locales

Every block label and every unit SHALL exist in `en`, `ru` and `zh`.

#### Scenario: A Russian topic

- **WHEN** the card is rendered for a Russian topic
- **THEN** no raw key appears in the card