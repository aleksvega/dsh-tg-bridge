# Where the code lives

The repository root is a **command surface**, not a code directory. Everything a
person types is there; everything a module imports is in a folder named after the
question it answers.

| Folder | Answers | Examples |
| --- | --- | --- |
| `core/` | how the process is wired: paths, state, secrets, keys, the dictionary | `paths.mjs`, `state.mjs`, `i18n.mjs` |
| `chat/` | one Telegram message, from arrival to reply card | `handle-message.mjs`, `telegram.mjs`, `media.mjs` |
| `turn/` | one turn: queue, progress, steer, failures, jobs | `turn.mjs`, `progress.mjs`, `failures.mjs` |
| `model/` | which model answers and what it costs | `model-probe.mjs`, `fallback.mjs`, `prices.mjs` |
| `profile/` | the person, the agent and their settings | `profiles.mjs`, `settings-card.mjs`, `agents.mjs` |
| `work/` | long-running work shown in the chat: diffs, forks, schedules, reports | `diff.mjs`, `rewind.mjs`, `goals.mjs` |
| `control/` | the `/commands` handler, one file per command family | `cmd-bridge.mjs`, `cmd-model.mjs` |
| `i18n/` | the three dictionaries | `en/`, `ru/`, `zh/` |
| `plugin/`, `skills/` | the DSH bundle and the skills it installs | |

## The root

Eleven modules stay at the top level because their path is part of the product:

```
bridge.mjs  cli.mjs  setup.mjs  bot-menu.mjs  sync-runtime.mjs  scan-secrets.mjs
bridge-kick.mjs  install-hooks.mjs  plugin-bridge.mjs  say.mjs  goal.mjs
```

`README.md`, `QUICKSTART.md` and the bridge's own progress protocol tell a person
(or an agent) to run `node ~/.dsh/tg-bridge/say.mjs --thought "…"`. Moving that
file would break a sentence this project keeps saying, so entry points are the one
rule the layout does not get to apply to libraries.

## Adding a module

1. Name the question it answers; put it in that folder.
2. Import it by relative path (`../core/paths.mjs`). There is no import map.
3. `package.json` `files[]` lists folders (`core/`, `chat/`, …), so a new file is
   published without touching the list. `test/package-files.test.mjs` fails if a
   module outside the listed trees is not shipped.
4. `test/module-size.test.mjs` reads the same `files[]` list, so the 500-line
   ceiling applies to the new file automatically.

## What the move changed in other files

- 566 relative specifiers were rewritten across 153 files.
- Tests that walked the repository root now read `files[]`
  (`test/module-size.test.mjs#shippedModules`) or recurse the tree, because a
  root-only walk would have gone green while checking eleven files.
- `cli.mjs` expands folder entries in `files[]` before copying, and
  `sync-runtime.mjs` already did.
