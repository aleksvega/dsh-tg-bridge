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

## Priority (set 2026-11-01, after the stability review)

The desktop surface was enumerated from the app bundle: 307 `@deepseek-ai/*`
packages, of which the `dsh-client-ui-*` plugins are the UI. Compared with the
56-command registry, this is the order that follows daily value, not the order
the cards were designed in. Stability (`2026-11-01-stability-first`) comes before
all of it.

| # | Surface | Desktop equivalent | Hours | Why here |
|---|---|---|---|---|
| 1 | Approvals firing | `dsh-client-ui-approval` | 5 | `requestApproval` and the `ap:` route already exist; the plugin never calls them. Highest value per hour, and the fail-closed precondition the roadmap calls P0. |
| 2 | File browser and read | `-sidebar-files` | 6 | The most common desktop act is "look at a file"; `/send` presumes the person knows the path. `/ls` with a keyboard closes it. |
| 3 | Plan mode as a mode | `dsh-plan-mode` | 8 | `/plan` today only *reports* state (`control/cmd-agents.mjs:373-389`) — it is not a control. |
| 4 | Mid-turn questions | `-user-questions` | 6 | The same seam as approvals; a turn that asks currently stalls silently. |
| 5 | Terminal | `-sidebar-terminal` | 10 | The main reason to reach for the desktop mid-task; one-shot `/shell`, owner-only. |
| 6 | Inline hints | `-commands` | 4 | Needs @BotFather inline mode, so it is the only surface with an external dependency. |
| 7 | Plugin settings read-back | `-settings-*` | 12 | The largest and least certain; a switch that cannot be read back is worse than no screen. |

**Considered and out of scope**, with the reason:

- **Browser tabs** (`-sidebar-browser`) — no webview in Telegram, and the agent's
  own `web_fetch` already answers "open this page" better than a screenshot.
- **Trajectory chart** (`-trajectory`) — a timing *chart*; as text it loses the
  point, as an image it is a screenshot of a UI nobody asked for. `/thoughts`
  already answers "what is it doing".
- **Open-in-app / native picker** (`-open-in-app`, `-directory-picker-native`) —
  their purpose is handing a path to a local GUI that does not exist on a remote
  surface. `/cd <path>` typed is correct.
- **Process inspectors** (`-cordis`, `-inspector`, `-entry-customization`) — the
  honest answer is "use the desktop app"; anything in chat is a stale snapshot.

Two traps for anyone reading the registry: `/plan` and `/permissions` are
read-only reporters, not controls, so they must not be marked done; and none of
the gaps above is blocked by the Bot API except inline mode.

## Non-goals

- No plan editor. The plan is prose the person can answer with another message;
  editing it in place is a different surface.
- No plugin marketplace change: this is the settings of a plugin already
  installed.
- No inline execution. Inline mode SHALL NOT run a turn or a command; it inserts
  text and nothing else.
- No browser tab, trajectory chart or native directory picker (reasons above).

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