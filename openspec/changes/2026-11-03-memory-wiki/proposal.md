# Proposal — a second brain as files the agent already reads

## Why

The person's stated goal is an agent that "knows everything about me, is my
second brain, a memory center that takes all the routine and structures all of
life". `dsh-tg-bridge` now has `/remember` — dated facts in a section of
`$DSH_HOME/AGENTS.md` — and that is a genuine long-term memory, but it is one
flat list with a 60-note cap. A week of real use outgrows it: facts about
projects, people, decisions and habits all compete for the same sixty lines,
and the only operations are "append" and "forget".

The field has converged on the same answer several independent times (OpenClaw,
AgentOS, SoulSpec, the Hermes nightly handoff): a **file-based personal
knowledge base** — SOUL.md for who the agent is, USER.md for who the person is,
a wiki of markdown pages for what has been learned — with no vector store and
no database. Markdown files are auditable, diffable in git, and readable by the
same harness injection that already loads AGENTS.md. The missing piece is
routing: which file a new fact belongs in, and how the whole tree stays small
enough that the per-request injection budget (`maxBytes` 65536) is not blown.

This change turns the bridge from "one list of notes" into "a small personal
wiki the agent curates itself, with the person watching from the chat". It is
deliberately built on the pieces that already exist and are already tested:
`/remember` (the write path and the `.bak` + rename discipline), `/remember
tidy` (a real turn doing the judgement work), `/find` (project search),
`/every` (scheduled consolidation), `/skills` (self-authored skills), and
`/branch` (work separation per topic).

## What changes

1. **The memory root.** `$DSH_HOME/memory/` — plain markdown pages, one wiki.
   `USER.md` holds facts about the person (preferences, people, routines);
   `PROJECTS.md` holds one section per active project; free-form pages live
   beside them. `AGENTS.md` keeps its `## Learned` section as the inbox: every
   `/remember <fact>` still lands there first, because that is the cheapest
   place a fact can land while its proper home is being decided.

2. **`/remember` gains routing, not a second write path.** A fact that names a
   project (`/remember project x: ...`) appends to that project's section; a
   fact about the person (`/remember про меня: ...` → USER.md) goes to USER.md;
   everything else stays in the Learned inbox. The rules are literal and
   documented — no silent classification, because a memory system that guesses
   where a fact belongs is a memory system that loses facts.

3. **Consolidation is a turn, not a rewrite.** `/remember tidy` already queues
   a real turn; it extends naturally: the turn reads the inbox, distributes its
   lines into pages, merges duplicates, and reports a diff as its answer. The
   nightly form arrives via the existing `/every` — a schedule whose text is
   the tidy prompt. The bridge never rewrites pages in the background.

4. **The wiki stays small by design.** Pages carry a soft line cap; the tidy
   turn reports pages over the cap instead of silently truncating. The
   injection into a session loads USER.md and the first lines of PROJECTS.md
   (the index), never the whole tree — full pages are read with `/find` or
   `/view` when a task needs them.

5. **Everything is inspectable from the chat.** `/remember` lists the inbox;
   `/remember user` shows USER.md; `/remember project <name>` shows that
   section; `/remember forget <word>` searches the whole wiki, not just the
   inbox. The person can audit the memory in one place and delete from it in
   one command — a private memory that its owner cannot read is a bug.

6. **The whole tree is git.** A private repository (the person's own remote or a
   local-only repo), one commit per tidy turn, so every consolidation is
   reversible and the memory has a history.

## Impact

- `control/cmd-skills.mjs` (`/remember` handler), `control/agents.mjs`
  (learned-section helpers grow a sibling for wiki pages), i18n ×3, docs.
- No new dependencies; no database; no vector store.
- The bridge stays personal-data-clean: the wiki lives in `$DSH_HOME`, which is
  already outside the public repo.
