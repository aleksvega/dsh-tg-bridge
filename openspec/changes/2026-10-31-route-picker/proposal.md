# Which route answers, and does the chat say so

## Why

Two cards told the person something untrue for four releases, and neither failed
loudly.

`/model` drew seventeen routes and none of their providers: each provider was a
`— name —` heading row, and a heading is an inline button with no callback data,
which the keyboard conversion deletes because Telegram rejects a whole message
that carries one. The card therefore arrived as a flat list of model names, in
which `deepseek-v4.1-flash` from two different endpoints was two buttons with the
same text and different actions. And no button did anything at all: the router
threw `ReferenceError: t is not defined` on every tap, because it was the one
caller that had to supply the translator and never imported it.

The failover chain has the same shape of dishonesty from the other side. A turn
that ended after nineteen minutes and 130 tool calls as
`OpenAI Responses stream completed with an unfinished tool call` matched no
failure family, so the chain logged "not a route fault" and broke on its first
entry — the turn died holding an error no other route had been asked about. From
the chat it read as "the chain did nothing".

Both are the same requirement: a route is a provider and a model, and every
control the chat draws must both work and say what it will do.

## What changes

1. **A route is chosen in two steps:** the endpoint, then its models. The endpoint
   step carries the route count and the mark; the model step names the endpoint in
   its header, so a model name is unambiguous and no screen draws two buttons with
   the same label.
2. **Nothing is drawn that the keyboard drops.** A label row is not a button.
3. **The card's router is the unit under test.** A press is claimed by the card
   that drew it, is acknowledged within the quiet-guard window, and is answered in
   the topic's language.
4. **The scope is visible and reachable.** "This topic" and "everywhere" are one
   row that says which is on, the header changes with it, and the toggle carries
   the endpoint so switching the mode does not throw the choice away — a card that
   says "this topic runs X" while every tap moves the install is worse than no
   header.
5. **A cut stream is the route's fault, with a budget of one.** The provider
   ended the answer mid-call; one other route answers "this proxy or this turn",
   and the chain stops rather than spending seven turns on the same question.
6. **A switch is announced once, with the reason the family gives**, and a
   give-up message appears only when the chain has proof: every entry tried, or a
   verdict from a probe.

## Non-goals

- No search inside the picker and no favourites row. Five endpoints and eight
  models fit on two screens; a second navigation mode is a different change.
- No per-topic failover chain, no per-route budget configuration, no new family
  without a live error that no existing family claims.
- No change to how a turn is spawned or how the provider is called; this is what
  the chat shows and what the chain does after a failure.

## Definition of done

1. `test/model-picker.test.mjs` drives `modelPressRouter` with a stubbed
   transport, and removing the `t` import fails that test and no other.
2. A test asserts no two drawn route labels collide, and another asserts every
   drawn button survives `inlineKeyboard`.
3. `test/fallback-chain.test.mjs` asserts the live truncated-stream string is the
   `stream` family, that it moves the chain, and that its budget is one.
4. A press on a route the profile no longer carries is refused with a sentence,
   not written to the file.
5. Every new string exists in `en`, `ru` and `zh`.

## Impact

- **Users**: the picker shows routes and the buttons work; a cut stream moves to
  the next route instead of ending the turn.
- **Maintainer**: the card's router is now the thing tests call, so the same
  class of dead wiring fails a test instead of shipping.
- **Risk**: the `stream` family replays a long turn once. A replay costs one turn,
  which is why the budget is one and not the whole chain.