# failover

## ADDED Requirements

### Requirement: A failure is classified as the route's fault or the task's

The chain SHALL walk only when the failure is a statement about the route, and
SHALL leave the turn alone when the failure is our own decision or the machine's.

#### Scenario: A provider refuses the request

- **WHEN** a route answers a 400-class rejection
- **THEN** the chain walks, because a strict vendor refusing a request another
  accepts is the case a chain exists for

#### Scenario: The turn hit its own time cap

- **WHEN** the turn stopped itself at the wall-clock cap
- **THEN** the chain does not walk, because no other vendor changes the clock

#### Scenario: An error matches no family

- **WHEN** a failure belongs to no family
- **THEN** the walk stops and logs the decision, so "no route was tried" can be
  told apart from "no route was left"

### Requirement: A stream the provider cuts mid-call is a route fault, with a budget of one

The chain SHALL classify an answer that ends with a tool call still open as the
`stream` family, SHALL move to the next route once, and SHALL stop after that
one attempt.

#### Scenario: The live failure

- **WHEN** a turn ends as `OpenAI Responses stream completed with an unfinished
  tool call: pwsh (…)`
- **THEN** the failure is the `stream` family, the chain tries one other route,
  and the chat's switch line says the provider ended the answer mid-call

#### Scenario: The next route also loses the stream

- **WHEN** the second route ends the same way
- **THEN** the chain stops after the second cut rather than replaying the turn on
  every remaining route, and the log says so

#### Scenario: The stream is cut by the network

- **WHEN** the connection drops before any answer
- **THEN** the failure is `transport`, not `stream`, and the whole chain is
  walked, because the request never reached a model

### Requirement: One route refuses, not the whole chain

A refusal SHALL be answered by one other route, and busy, rate, quota and
transport failures SHALL be walked to the end of the chain.

#### Scenario: Six routes refuse identically

- **WHEN** the request itself is refused and the budget of one is spent
- **THEN** the walk stops, and the message says the request rather than the route
  is what is refused

#### Scenario: A balance is spent behind a 403

- **WHEN** a route answers `403 … allowance … used up`
- **THEN** it is classified as quota rather than auth, because topping up is the
  fix and replacing the key is not

### Requirement: A switch is announced once, with its reason

The chat SHALL name the reason for a switch, from the family rather than from the
raw error, once per switch.

#### Scenario: The chain moves

- **WHEN** a turn is replayed on another route
- **THEN** the topic receives one line naming the reason and the model now
  answering, in the topic's language

### Requirement: A give-up message needs proof

The "all models are unavailable" message SHALL appear only when every entry was
tried or a probe returned a verdict, and SHALL name the next action.

#### Scenario: One entry was skipped

- **WHEN** a short chain stopped after one entry with no verdict
- **THEN** no give-up message is sent, because that is not proof of anything

#### Scenario: Every route is out of context window

- **WHEN** every route reports a window overflow
- **THEN** the message says a wider window or a shorter conversation is the fix,
  and that topping up a balance will not change it

### Requirement: The chain walked is the chain the card counts

The probe, the walk and the `/fallback` card SHALL read one list, so "the card
says seven" and "seven were tried" cannot disagree.

#### Scenario: A route is switched off

- **WHEN** a route is turned off from the card
- **THEN** it stays in `config.json` with its overlay file and is not tried,
  and the card's count matches the walk