# What "done" means, written down before the next feature

## Why

The suite passed while two cards in the chat were dead for four releases. Neither
failure was subtle: `/model` threw `ReferenceError: t is not defined` on every
tap from 1.32.0 to 1.37.0, and its provider headings were invisible from the
first day the picker existed. Both survived because the tests exercised the inner
handler and the card's own exports — the wiring a person's tap actually travels
was never called by any test. A green count is not acceptance; the counts were
green.

The same shape recurs in review: a string added to one locale, a button drawn
without a payload, a claim about a provider that nobody measured, a fix with no
test that fails without it. Each is cheap to check and expensive to miss, and
each has already cost a release.

This change does not add a feature. It writes the bar down as requirements with
scenarios, so "is this finished" has an answer that does not depend on who is
reading the diff.

## What changes

1. **Acceptance is a command.** One command, from the repository root, with
   `DSH_HOME` unset, and no test weakened to reach green.
2. **A fix carries the test that fails without it.** If the reviewer cannot name
   that test, the fix is not finished.
3. **Three locales in the same commit**, and a key whose consumer is gone is
   removed from all three — a dead key is a promise the code stopped keeping.
4. **A control the chat cannot keep is not drawn.** Every inline button carries a
   payload Telegram accepts; every drawn control reaches its handler through the
   export that the runtime calls, not only the inner function it wraps.
5. **No new dependency, no module over 500 lines.**
6. **A claim is measured.** A statement about a provider, a path or a platform
   records the observation that supports it; the test asserts the behaviour, not
   the network.

## Non-goals

- No coverage percentage. A percentage is a number that goes up when a test is
  added and tells nobody whether the path a person takes is covered.
- No CI matrix change, no new runner, no dependency to measure anything.
- No retroactive rewriting of old tests: the bar applies to changes from this one
  forward, and the tests that encoded a dead control are repointed where they are
  touched.

## Definition of done

1. `openspec/specs/quality-bar/spec.md` (after archive) states every requirement
   above with at least one scenario each.
2. `test/` contains a failing-without-the-fix test for the two card defects this
   change was written after: the router wiring and the dropped heading.
3. The prose here matches the tests: every scenario names the test file that
   enforces it, or says plainly that it is a review rule with no test.

## Impact

- **Users**: nothing changes in the chat. What changes is how often a dead button
  reaches them.
- **Maintainer**: a fix now costs one test that fails on the previous revision.
  That is the cheapest form of the guarantee.
- **Risk**: a rule with no test is an opinion. Each requirement says which kind it
  is, so the untested ones are visible instead of assumed.