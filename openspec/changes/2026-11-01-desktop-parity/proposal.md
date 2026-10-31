# The desktop controls that Telegram still cannot reach

## Why

Three things a person does in the desktop app have no honest answer in the chat,
and each one is a question the chat already answers badly.

**Plan mode.** The desktop app lets a model propose a plan and stop before it
touches a file. In Telegram the same request either runs immediately or is refused
by the sandbox, so "show me the plan first" has to be typed as prose and trusted.

**Plugin settings.** `/plugin` can list and install, but a plugin's own settings
are desktop-only. The chat's answer today is a paragraph of prose, and a settings
screen built without a read-back is a screen of switches that may do nothing —
which is worse than not offering it.

**Inline hints.** The bot has a command list, and it is only visible after the
command is half-typed. Typing `@bot rew` in any chat should show `rewind` with its
parameters, the way every other bot does; today the person has to remember the
spelling this repo spent a release making unique.

## What changes

1. **`/plan` turns plan mode on for one topic.** The model is asked for a plan and
   told not to act; the chat gets a card with **Approve** and **Keep planning**.
   Approve releases the same turn to act; Keep planning asks for a revision
   without leaving plan mode. The mode is per topic and survives a restart.
2. **Plugin settings are read from the plugin, not guessed.** A setting row exists
   only when the plugin reports the key, its current value and its type; a write is
   read back and the card shows the value the plugin now holds. A setting whose
   value cannot be read back is shown as unsupported, not as a switch.
3. **Inline mode suggests commands with their parameters.** Typing `@bot <prefix>`
   answers with up to twenty commands whose name starts with the prefix, each with
   its usage line; choosing one inserts it without sending, so the person finishes
   the text.

## Non-goals

- No plan editor. The plan is prose the person can answer with another message;
  editing it in place is a different surface.
- No plugin marketplace change: this is the settings of a plugin already
  installed.
- No inline execution. Inline mode SHALL NOT run a turn or a command; it inserts
  text and nothing else.

## Definition of done

1. Plan mode is asserted by a test that a turn in plan mode performs no write, and
   that Approve performs one, with the tool calls inspected rather than the prose.
2. Every settings row in the card is backed by a read-back: a value the plugin
   does not return is not drawn as a control.
3. Inline mode is asserted by a test that a prefix returns matching commands with
   usage, that nothing is executed, and that a query with no match answers with
   the hub instead of an empty list.
4. All three locales, in the same commit.
5. Each surface answers within the quiet-guard window, and every callback is
   acknowledged on the path a real tap takes.

## Impact

- **Users**: three gaps close; each keeps the existing names and does not change
  how a turn runs outside the new mode.
- **Maintainer**: one card per surface, each with its own router and its own test,
  following the shape `/model` and `/diff` already use.
- **Risk**: plan mode is a promise about the sandbox. If the flag can be ignored
  by a tool, the card must say so rather than claim the turn cannot write.