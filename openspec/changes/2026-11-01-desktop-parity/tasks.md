# Tasks — plan mode, plugin settings, inline hints

## 0. Plan mode

- [x] 0.1 State: `state.planMode[key]`, per topic, written with `saveState`.
- [x] 0.2 `/plan` toggles it, reports it, and is listed in the control registry,
  the `/help` page and the `Tuning` group.
- [x] 0.3 The turn is asked for a plan and told not to act; the refusal of a
  writing tool is part of the turn, not a dead end.
- [x] 0.4 A card with **Approve** and **Keep planning**, its own router, and the
  press acknowledged on the path a real tap takes.
- [x] 0.5 The card says whether the guarantee is the sandbox's or the model's,
  from the topic's preset.
- [x] 0.6 Test: a plan-mode turn performs no write; Approve performs one; a stale
  card executes nothing.
- [x] 0.7 Three locales.

## 1. Plugin settings

- [x] 1.1 There is no such service to ask: `dsh plugin` only forwards to pnpm,
  no shipped package declares a settings schema, and a headless turn has no
  client to call. The card reads `cordis.patch.yml` instead — the file that
  actually decides what the host loads — and only the keys a row configures.
- [x] 1.2 The card draws one control per supported key and a value (not a
  control) for the rest: a boolean is a switch, a number or string is printed,
  a nested block is named with its line count and never flipped.
- [x] 1.3 Write, read back, and render the value the profile returned.
- [x] 1.4 Write to the topic's profile only: the path comes from the profile,
  and the row is matched by id, so two profiles cannot touch each other.
- [x] 1.5 Test: a value that does not stick is shown as refused; a read-only key
  is not a toggle; a card older than the profile executes nothing.
- [x] 1.6 Three locales.

## 2. Inline hints

- [x] 2.1 `answerInlineQuery` from the command registry: prefix match, twenty
  results, usage line as the description.
- [x] 2.2 An empty prefix offers the most used commands; no match offers the hub.
- [x] 2.3 Results execute nothing. Telegram has no way to put text into the
  input box from an inline result, so a result posts the usage line instead —
  written without its slash — and a message that arrives `via_bot` is dropped
  before it reaches a turn. Enabling inline mode is still @BotFather's job.
- [x] 2.4 The answer is built from the registry and the language only; a test
  asserts two different chats with the same query get the same answer.
- [x] 2.5 Test: a prefix returns the command with its usage; nothing is executed.
- [x] 2.6 Three locales.

## 3. Acceptance for all three

- [ ] 3.1 Suite green, no new dependency, no module over 500 lines.
- [ ] 3.2 Every press answered inside the quiet-guard window.
- [ ] 3.3 Measured on the live bot before release: each card opened, each button
  pressed, each result observed.
- [ ] 3.4 CHANGELOG names each surface and its limit.