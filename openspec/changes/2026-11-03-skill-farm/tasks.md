# Tasks — skills the agent grows itself

## 0. The write path

- [ ] 0.1 `control/agents.mjs`: `skillPath(name)` / `archivePath(name)` under
      `~/.dsh/skills` and `~/.dsh/skills-archive`, with the same traversal
      rejection as `/skills <name>` (relative stays inside, no absolute, no
      `..`). Test: `../escape`, absolute input, a clean kebab name.
- [ ] 0.2 `writeSkill(name, body)` — mkdir, `.bak` of an existing SKILL.md,
      temp-file rename in. Test: first write, overwrite (`.bak` updated), the
      frontmatter the router needs present in the result.
- [ ] 0.3 `retireSkill(name)` — move the directory to the archive root with a
      one-line provenance header prepended to SKILL.md; a name already in the
      archive gets a dated suffix instead of a clobber. Test: retire, retire
      the same name twice, retire a name that does not exist (one sentence).

## 1. Gather — the proposal turn

- [ ] 1.1 `/skills gather` requires `ctx.redeliver` (the same refusal lane as
      `/remember tidy` when it is missing). Test: refusal string, nothing
      queued.
- [ ] 1.2 The queued message is `ctrl.skills.gatherTask` (ru/en/zh): reread
      the recent sessions of this project (the same session files `/find`
      reads), find the solution that repeated or the procedure that cost real
      effort, propose ONE skill — kebab name, `description: Use when…` with
      trigger words, imperative steps, failure modes — as the chat answer, and
      nothing else. The bridge never writes a skill from gather alone.
- [ ] 1.3 The immediate answer (`ctrl.skills.gatherStarted`) says a turn is
      running and the proposal will arrive as a message. Test: string present,
      redeliver called once with the topic key, synthetic message shape
      (chat/from/thread) matching the queue's expectation.

## 2. Adopt — the person's yes

- [ ] 2.1 `/skills adopt` with no argument: the bridge takes the last gather
      proposal text it can find from the turn's own answer in the topic (the
      state already tracks per-topic last turn text via `lastTurnText`; reuse,
      do not add a second source). Test: adopt after a proposal, adopt with
      nothing to adopt (one sentence, no write).
- [ ] 2.2 `/skills adopt <name>` with a reply quoting the proposal: the reply
      text is the body that lands on disk (the person's edit wins over the
      proposal). Test: the file body matches the reply, not the proposal.
- [ ] 2.3 The adopt answer names the skill and says hot-reload makes it
      invocable from the next turn, and reminds once that the lifecycle
      expects a strip-after-use pass. Test: string contains both facts.

## 3. Retire and audit

- [ ] 3.1 `/skills retire <name>` moves to the archive and answers with the
      archive path (no secrets — it is under DSH_HOME). Test as 0.3, plus the
      answer string in three locales.
- [ ] 3.2 `/skills` listing gains line count and mtime per skill. Test: two
      fixture skills, the card lists both numbers.
- [ ] 3.3 The listing flags the catalog size against the 25 cap (one line,
      three locales). Test: 26 fixture skills → the line appears; 24 → absent.

## 4. Docs and locales

- [ ] 4.1 `docs/COMMANDS.md` regenerated; `/skills` row gains the three verbs.
- [ ] 4.2 CHANGELOG bullet.
- [ ] 4.3 Strings ru/en/zh; the locale-shape and module-size tests stay green.
