# A topic owns its workspace, its permissions, and its bug reports

## Why

Three things a person can do in the desktop app have no honest answer in
Telegram today, and one of them is already causing damage.

| Question | What the code does now | What that means |
| --- | --- | --- |
| Which folder does this topic work in? | `state.cwd[key]`, set by `/cd`, passed to the CLI as `cwd` (`turn.mjs:39`) | works, but has no test, and a stale path silently falls back to `config.cwd` |
| What may a turn touch? | one profile-wide table, `defaultPreset: danger-full-access`, `workspaceRoot: C:/Users/bistr` | **every topic may write every project in the home directory** — the reported "the Latin-bot project reaches into the game project" |
| Where does a user's error go? | `/logs` on the owner's machine, `bridge.log` | a stranger has to retype a stack trace into a chat, and the owner cannot reproduce it |

The sandbox row is the real fault. Its comment claims "home-wide writes only …
cannot touch C:\Windows", and that is true — but "home-wide" is the whole point
of the complaint. `workspaceRoot` is one directory for the entire install, so a
per-topic `cwd` decides where a turn *starts*, never what it may *reach*: a turn
bound to `Projects/latin-bot` may still write `Projects/game` with one absolute
path. `danger-full-access` makes that path legal everywhere.

## What changes

1. **A workspace is a permission boundary, not a starting directory.** A topic
   gets `workspaceRoot` = its bound project, so `workspace-write` means "this
   project" and nothing else. An unbound topic keeps the install default.
2. **The permission preset becomes a per-topic choice**, materialised the same
   way `/crew` already materialises a model (`aset-profile.mjs`): a topic with
   its own preset runs under a derived profile, so `/permissions read-only` in
   one topic stops being a profile-wide switch.
3. **`/cd` is tested on every platform it claims.** Windows drive letters, POSIX
   absolute paths, `~`-relative project names, a path that no longer exists, and
   `reset` — each one asserted, because the current regex is the only thing
   deciding which of the two shapes a path is.
4. **A turn reports its own failure as one forwarded file.** `/report` writes a
   redacted bundle (version, profile, model, the failing turn's tail, the tool
   names it called) and sends it as a document, so a stranger's bug reaches the
   owner as data instead of prose.
5. **Fallback chains are per-install configuration, not per-user code.** The
   chain stays in `config.json`; what changes is that a chain entry may name a
   provider the profile does not declare, and an install with several accounts
   on one vendor can list them as separate entries.

## Non-goals

- No OAuth, no subscription login (Codex/Claude/ChatGPT plans). The bridge
  speaks API endpoints with a key; anything else is a different feature with a
  different threat model, and pretending otherwise is worse than saying no.
- No new sandbox engine. The host already has the modes; the change is which
  directory they apply to and who may pick one.
- No change to how a turn is spawned, no new dependency, no daemon.

## Definition of done

1. `workspaceRoot` for a bound topic is that topic's directory; asserted by a
   test that reads the generated profile, not by review.
2. `/permissions` in one topic does not change another topic's preset.
3. `test/cd.test.mjs` covers the five path shapes above on the host platform,
   and the platform-specific branch is exercised by table, not by CI matrix.
4. `/report` produces a file with no token, no key and no home path in it,
   asserted by the same scan that guards the release (`scan-secrets.mjs`).
5. CHANGELOG names the behaviour change plainly: topics that used to write the
   whole home directory now write their own project.

## Impact

- **Users**: a topic stops reaching a neighbour project. Someone who relied on
  the home-wide write must either bind a wider directory or pick
  `danger-full-access` for that topic explicitly — the change is a default, not
  a removal.
- **Maintainer**: one more derived profile per topic that overrides a preset,
  pruned by the same sweep that prunes model overlays.
- **Risk**: a derived profile that fails to materialise silently runs the base
  preset, i.e. the *wider* one. The fallback must therefore be the narrow
  direction: a topic that asked for `read-only` and got a broken overlay must
  refuse the turn, not run it unconfined.
