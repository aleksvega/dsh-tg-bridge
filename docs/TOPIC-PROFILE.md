# Per-topic agent profiles

One bridge, many topics, and each topic should not work like the others: a game
project needs rules about the engine and the build, a research topic needs rules
about sources and citations, a planning topic needs rules about scope. This page
is how that is configured, and what the harness actually loads.

Everything here is DSH behaviour plus one bridge field. Nothing in the bridge
rewrites your `AGENTS.md`, and nothing re-implements instruction loading.

## What a turn reads, in order

The harness loads workspace instructions from `dsh-agent-instructions`. Broad
first, each layer more specific than the one before:

| # | File | Scope | Who writes it |
|---|---|---|---|
| 1 | `$DSH_HOME/AGENTS.md` | this computer, every topic, every project | you, or `/remember` |
| 2 | `$DSH_HOME/profiles/<profile>/…` rows | profile-level defaults | the profile patch |
| 3 | `<project>/AGENTS.md` | the project the topic works in | you |
| 4 | `<project>/AGENTS.<name>.md` | **this topic's set** | the bridge, on `/crew instructions` |
| 5 | `<project>/*.local.md` | local overlay per directory | you |

A layer is only read when a profile names it as a *candidate*. That is what keeps
topics apart: `AGENTS.game.md` is a candidate only for the profile of the set that
named it, so two topics in the same directory share 1 and 3 and never see each
other's 4.

Order matters. A line in a topic file is the most specific instruction the agent
has, so it beats the project's rules — reach for it when a rule is *for this
topic*, not when it is true of the project.

The chain is re-read when the session's working directory changes, and nested
files discovered by file operations are picked up on later turns.

## Giving a topic its own rules

1. A set is the topic's own profile — model, permissions, preset, subagents,
   skill directories and rule file. Create one and give it a rule file:

```
/crew new game
/crew instructions AGENTS.game.md
/crew use game
```

`/crew instructions` writes the candidate name into the set, and creates the file
in the directory this topic's turns run in when it is missing. The answer says
which file, where. `/crew show` lists the file next to the model and permissions.

2. Write rules into that file. Either edit it in the desktop app, or ask the agent
   in the chat — it is a normal file in the workspace: *"добавь в правила темы:
   сборка только через `pnpm build`, тесты перед коммитом"*. The next turn reads
   it, because it is in the chain.

3. `inherit` clears the field and the topic goes back to the project's own files:

```
/crew instructions inherit
```

## Own skills

`/crew skills <dir>` adds a directory to the catalog this topic scans, on top of
the install's roots. Useful when a project ships skills that must not appear in
every other topic. The directory is a `SKILL.md` collection, the same shape as
`~/.dsh/skills`:

```
/crew skills C:\work\game\.dsh\skills
```

Give an absolute path. A relative one is resolved by DSH, not by the bridge, and
the bridge will not guess for you.

## What a candidate name may be

A bare file name ending in `.md`: `AGENTS.game.md`, `RULES.research.md`. A path is
refused, because candidates are matched **per directory** — a path would never
match and the rule would read as applied while the model never saw it. Nothing is
stored in that case: the answer says which name cannot load and why, instead of
leaving a setting that cannot work.

## What it costs

Every loaded file is paid for on every request. That is why the budget exists
(`maxBytes`, 65 536 by default in the bridge's profile) and why broad files are
dropped before the most specific one is truncated. Keep a topic file to the rules
that actually change behaviour, not a project diary; `/remember` is for facts, and
the project's `AGENTS.md` is for what is true of the whole project.

## Failure modes

- **A typo in the name.** The file is created by the command, so the usual typo is
  caught at the moment of naming. A file renamed later simply stops loading —
  `/crew show` names the candidate, so the fix is visible.
- **A topic with no set.** It runs the base profile: global and project files
  only, which is the same behaviour a fresh install has.
- **Two topics, one set.** They share the set's rule file, deliberately: a set is
  a profile, and binding both topics to it is the way to say "these two work the
  same way".
