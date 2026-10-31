# model-routes

## ADDED Requirements

### Requirement: A route is chosen in two steps

The picker SHALL open on the endpoints, SHALL list one endpoint's models on the
next screen, and SHALL NOT draw two buttons on one screen with the same label.

#### Scenario: The card opens

- **WHEN** a person sends `/model`
- **THEN** the card lists each endpoint with how many routes it carries, and the
  endpoint serving the current route is marked

#### Scenario: One model, two endpoints

- **WHEN** two endpoints both serve `deepseek-v4.1-flash`
- **THEN** each appears once on the endpoint step, and the model appears on two
  different screens that are never shown together

#### Scenario: A model name is too long to be a button

- **WHEN** a route's callback data would exceed Telegram's 64 bytes
- **THEN** that model gets no button and the card says how many were left out,
  rather than drawing a button that cannot be sent

### Requirement: Step two names the endpoint it belongs to

The second screen SHALL name its endpoint in the header, SHALL offer a row back to
the endpoint list, and SHALL carry the scope it was opened in.

#### Scenario: A model screen is read

- **WHEN** the endpoint step is opened for `unorouter`
- **THEN** the header names `unorouter`, the buttons are that endpoint's models,
  and a back row returns to the endpoint list

#### Scenario: The choice is made

- **WHEN** a model is pressed
- **THEN** the card returns to the endpoint list with the mark on the endpoint now
  answering, because staying on the model screen of the endpoint just left reads
  as "it did not take"

#### Scenario: Refresh while choosing

- **WHEN** refresh is pressed on a model screen
- **THEN** the same endpoint's models are redrawn, not the endpoint list

### Requirement: Every drawn button survives the keyboard

The card SHALL NOT draw a control that the keyboard conversion discards.

#### Scenario: A provider heading

- **WHEN** a card would draw an endpoint name as a row of its own
- **THEN** the row is not drawn as a button, because a button without a payload is
  dropped by the conversion and takes the explanation with it

#### Scenario: A test counts the rows

- **WHEN** the card is rendered in a test
- **THEN** every button it returns survives `inlineKeyboard`, asserted by
  comparing the two lengths

### Requirement: A press is claimed by the card that drew it

The card's router SHALL claim the callback data it understands, SHALL NOT claim
another card's, and SHALL acknowledge every claimed press.

#### Scenario: A model is tapped

- **WHEN** a model button is pressed
- **THEN** the route is written, the card is redrawn in place, the tap is
  acknowledged so the spinner stops, and the claim is logged once

#### Scenario: Another card's data arrives

- **WHEN** the router is given `df:…` or any prefix it does not own
- **THEN** it returns false without throwing and without writing anything

#### Scenario: The endpoint or route is gone

- **WHEN** a stale button names an endpoint or model the profile no longer carries
- **THEN** nothing is written and the answer says the profile changed, so the
  person refreshes instead of believing the switch worked

### Requirement: The scope is visible and carried across the steps

The card SHALL show whether a tap changes this topic or the whole install, SHALL
let the person change that from the card, and SHALL keep the step it was pressed
on.

#### Scenario: The global scope is on

- **WHEN** the scope is "everywhere"
- **THEN** the header names the install's default route rather than this topic's,
  and the toggle row says how to go back to one topic

#### Scenario: The mode is switched on a model screen

- **WHEN** the scope is toggled while an endpoint's models are on screen
- **THEN** the same models are redrawn in the new scope, and no route is written

#### Scenario: A global route is tapped

- **WHEN** a model is pressed in the global scope
- **THEN** the profile's default model is rewritten and no per-topic override is
  created

### Requirement: Nothing to pick is three different sentences

The card SHALL distinguish a profile with no models, an endpoint whose every model
is too long to be a button, and rows cut off by the row cap.

#### Scenario: A profile has no models

- **WHEN** the profile declares no models
- **THEN** the card says the profile has no models and names the profile

#### Scenario: The cap hides models

- **WHEN** more models exist than the row cap allows
- **THEN** the card says how many were left out and how to name one without a
  button

### Requirement: The card speaks the topic's language

Every label, header and answer SHALL exist in `en`, `ru` and `zh`, and SHALL be
read from the topic's language.

#### Scenario: A Russian topic on an English install

- **WHEN** the card is rendered for a Russian topic
- **THEN** no raw key appears in the text or in a button label