# Tasks — plan mode, plugin settings, inline hints

## 0. Plan mode

- [ ] 0.1 State: `state.planMode[key]`, per topic, written with `saveState`.
- [ ] 0.2 `/plan` toggles it, reports it, and is listed in the control registry,
  the `/help` page and the `Tuning` group.
- [ ] 0.3 The turn is asked for a plan and told not to act; the refusal of a
  writing tool is part of the turn, not a dead end.
- [ ] 0.4 A card with **Approve** and **Keep planning**, its own router, and the
  press acknowledged on the path a real tap takes.
- [ ] 0.5 The card says whether the guarantee is the sandbox's or the model's,
  from the topic's preset.
- [ ] 0.6 Test: a plan-mode turn performs no write; Approve performs one; a stale
  card executes nothing.
- [ ] 0.7 Three locales.

## 1. Plugin settings

- [ ] 1.1 Read a plugin's settings schema and current values from the same
  service the desktop app uses; a key with no value or no type is unsupported.
- [ ] 1.2 The card draws one control per supported key and a value (not a
  control) for the rest.
- [ ] 1.3 Write, read back, and render the value the plugin returned.
- [ ] 1.4 Write to the topic's profile only.
- [ ] 1.5 Test: a value that does not stick is shown as refused; a read-only key
  is not a toggle.
- [ ] 1.6 Three locales.

## 2. Inline hints

- [ ] 2.1 `answerInlineQuery` from the command registry: prefix match, twenty
  results, usage line as the description.
- [ ] 2.2 An empty prefix offers the most used commands; no match offers the hub.
- [ ] 2.3 Results insert text and execute nothing.
- [ ] 2.4 The answer is built from the registry and the language only; a test
  asserts two different chats with the same query get the same answer.
- [ ] 2.5 Test: a prefix returns the command with its usage; nothing is executed.
- [ ] 2.6 Three locales.

## 3. Acceptance for all three

- [ ] 3.1 Suite green, no new dependency, no module over 500 lines.
- [ ] 3.2 Every press answered inside the quiet-guard window.
- [ ] 3.3 Measured on the live bot before release: each card opened, each button
  pressed, each result observed.
- [ ] 3.4 CHANGELOG names each surface and its limit.