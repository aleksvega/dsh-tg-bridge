# Proposal — skills the agent grows itself

## Why

The skill-protocol already runs on this machine (`~/.dsh/AGENTS.md`, step 3 of
the lifecycle): after a task, "if you solved the same non-trivial thing
manually a second time — distill it into a new skill". It works, but it leans
entirely on the agent remembering to notice. Nothing collects the raw
material: the repeated solution stays buried in session files, and the next
session never sees it. The Hermes lineage this repo borrows from solves that
with a collector (`memory-to-skill` over memsearch) — a step that looks back at
recent sessions, finds the repetition, and proposes the SKILL.md.

The second gap is discipline on the way IN: a skill a subagent or a nightly
turn writes is a prompt that every later session pays for. The lifecycle caps
the catalog (< 25 in `~/.dsh/skills`), demands hot-reload (DSH picks up a new
SKILL.md from the next turn), demands a re-read after use (strip what the task
proved unnecessary), and demands a security scan for third-party skills only —
but none of that is enforced where the skill is born. A collector that dumps
every reusable trick into the catalog would break the budget in a week.

This change adds the missing collector as a chat command, with the discipline
built into the flow: it gathers candidates, proposes one skill at a time,
waits for the person's yes, writes with the same `.bak` + rename care as the
rest of the bridge, archives instead of deleting, and keeps the catalog small
by moving the stale to `~/.dsh/skills-archive/`.

It is deliberately not automation: nothing writes a skill while the person
sleeps. The one thing the ecosystem agrees on is that self-written instructions
must stay under the owner's eye, because a skill is a standing order the agent
will follow later without showing it again.

## What changes

1. **`/skills` gains a gather verb.** `/skills gather` queues a real turn
   (the same `redeliver` path `/remember tidy` uses) whose prompt tells the
   agent: look back over the recent sessions of the current project, find the
   solution that repeated or the procedure that cost real effort, and propose
   ONE skill — name, description with trigger words, imperative steps — as
   the chat answer. The bridge does not decide what is worth a skill; the turn
   does, with the judgement of a model, and the person reads the proposal in
   the chat.

2. **`/skills adopt` writes the proposed skill.** After the person answers
   yes (or edits the proposal by replying to it), `/skills adopt` writes
   `~/.dsh/skills/<kebab-name>/SKILL.md` with the frontmatter the router
   needs (`name`, `description: Use when…`). One write, one `.bak`, hot-reload
   picks it up on the next turn. If the proposal in the chat was edited, the
   reply's text is the version that lands on disk.

3. **`/skills retire <name>` archives instead of deleting.** The file moves
   to `~/.dsh/skills-archive/<name>/` with a one-line header noting the date,
   and the answer says where it went. The catalog cap stays a human decision,
   but the command makes the cheap path the safe one.

4. **The catalog is audited from the chat.** `/skills` already lists; it gains
   the line count and last-used date per skill (from file mtimes and the
   sessions' tool log when cheap), so "which skills earn their context" is a
   question the chat can answer without opening a directory.

5. **No third-party path.** This flow never installs from outside; the
   existing security scan rule stays the only door for that, and this change
   does not touch it.

## Impact

- `control/cmd-skills.mjs` (`/skills` handler grows gather/adopt/retire),
  `control/agents.mjs` (page-write helpers reused), i18n ×3, docs, CHANGELOG.
- No new dependencies. DSH hot-reload does the integration; the bridge only
  writes files in the directories it already owns.
- Keeps the repo personal-data-clean: sessions are read by the turn on the
  machine, never copied into the repo.
