# Split the giant files: no shipped module over 500 lines

## Why

Two files carry a third of the project and most of its risk.

| File | Lines | What it really is |
| --- | --- | --- |
| `bridge.mjs` | 2966 | update loop, Telegram transport, turn runner, progress panel, media, steer, callbacks, 116 top-level declarations |
| `control.mjs` | 2759 | a registry, six stores, and `handleControl` — **one function of 1868 lines** holding 43 commands |
| `i18n/en.mjs`, `ru.mjs`, `zh.mjs` | 654 each | one dictionary, 624 keys, 418 of them under `ctrl.` |

That is a risk profile, not a style complaint. Every change is reviewed against
the neighbours of the code it touches, and the neighbours are 1800 lines away.
Both shipped faults of the 1.19.x line lived in exactly these files:

- `/update confirm` rewrote a file it never read, so a release could not install;
- `allowedSender(msg)` lost its second argument during a refactor, the allowlist
  read as empty, and the bot silently dropped every message including the
  owner's.

Neither was subtle. Both were invisible because a 3000-line file does not fit in
a review.

## What changes

`bridge.mjs` and `control.mjs` become thin entry files that wire modules
together. The largest resulting module is 472 lines, the median is 160. The
`i18n` dictionaries split by namespace, one file per locale per namespace, with a
key-parity test already in place to catch a lost translation.

The existing `docs/REFACTORING.md` set the ceiling at ~700 lines and a seven-step
plan; this change supersedes the target (500) and the step list (leaf modules
first, one command group per step), and keeps its invariants unchanged.

## Non-goals

- No rewrite. Not one module is re-authored; code moves, comments move with it.
- No behaviour change, no new commands, no renamed commands, no new options.
- No dependency changes, no ESM/CJS switch, no bundler, no TypeScript.
- No formatting sweep. A move diff reads as a move or it does not ship.

## Definition of done

1. Every source module under `500` lines, enforced by `test/module-size.test.mjs`,
   not by review.
2. No import cycles, enforced by `test/import-cycles.test.mjs`.
3. `node --test` green after every step, 353 tests and growing — the new
   structural tests are the only additions.
4. `package.json.files[]` and `sync-runtime.mjs` carry every new module;
   `test/package-files.test.mjs` fails otherwise and must stay green.
5. Each step is one commit and one patch release whose CHANGELOG line says "no
   behaviour change" and gives the line counts.

## Impact

- **Users**: `/update` delivers the move; nothing else changes. `/version` proves
  which file set is running.
- **Maintainer**: a review of any single command now fits in one screen.
- **Risk**: the moves are mechanical and covered by the suite; the real danger is
  module-level state (see `design.md`, "cycles and state").
