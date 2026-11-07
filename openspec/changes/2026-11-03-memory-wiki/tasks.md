# Tasks — the memory wiki

## 0. The page layer

- [ ] 0.1 `control/memory-wiki.mjs`: `pagePath(name)` resolves a page name to
      `$DSH_HOME/memory/<safe-name>.md`, rejecting `..`, absolute paths and
      separators the same way `/skills <name>` does. Test: traversal attempts,
      unicode names, the empty name.
- [ ] 0.2 `readPage(name)` / `writePage(name, body)` — write goes through the
      same `.bak` copy + temp-file rename discipline as AGENTS.md, because the
      harness re-reads these files too. Test: a page written, a page missing,
      the `.bak` beside it.
- [ ] 0.3 `USER.md` and `PROJECTS.md` exist after `ensureWiki()` creates them
      with one-line headers when absent. Test: first call creates, second call
      is a no-op that does not touch mtimes.
- [ ] 0.4 `appendSection(file, heading, line)` appends a dated line under a
      heading, creating the heading when absent — the same "everything around
      it survives" discipline the Learned section already has. Test: append to
      an existing section, to a missing section, to an empty file, with a
      section that follows.

## 1. Routing the inbox

- [ ] 1.1 `/remember project <name>: <fact>` appends to the `<name>` section of
      PROJECTS.md. Test: a new project section appears dated; a second fact
      lands under the same heading; the Learned inbox is untouched.
- [ ] 1.2 `/remember user <fact>` (and the ru/zh forms "про меня", "关于我")
      appends to USER.md. Test: three locales route to the same file.
- [ ] 1.3 Everything without a route lands in the Learned inbox, exactly as
      today. Test: the plain fact still writes AGENTS.md.
- [ ] 1.4 `/remember user` and `/remember project <name>` with no fact show the
      page (tail, 10 lines like the inbox list). Test: the card shows the last
      lines, not the whole file.

## 2. Tidy as the curator

- [ ] 2.1 `ctrl.remember.task` (all three locales) grows the wiki instructions:
      read the Learned inbox, move each line to USER.md or the matching
      PROJECTS.md section, merge duplicates, keep dates, leave 60 lines max,
      report the moves as the turn's answer. The bridge still writes nothing
      itself during tidy — the turn's own write tools do the work.
- [ ] 2.2 The tidy turn's report is the chat answer, so the person reads what
      moved without opening a file. Test (string-level): the locale prompt
      demands a list of moves.
- [ ] 2.3 `/every` with the tidy prompt is documented as the nightly form in
      `ctrl.help.about.remember` (three locales). No new schedule machinery.

## 3. Audit and erase

- [ ] 3.1 `/remember forget <word>` searches the inbox, USER.md and
      PROJECTS.md; whole-line erase in each, with the per-file count in the
      answer. Test: a word present in two files erases from both; a word
      present nowhere changes nothing.
- [ ] 3.2 `/remember wiki` lists the pages with line counts. Test: created
      pages appear; the empty wiki says so.
- [ ] 3.3 Soft caps: pages over 120 lines are listed by the tidy prompt, not
      truncated. Test at the prompt-string level.

## 4. Injection budget

- [ ] 4.1 A session-facing index — the tidy turn is told to keep PROJECTS.md
      headings one-line each, because the profile's `@deepseek-ai/dsh-agent-instructions`
      chain (maxBytes 65536) is what pays for these files. Documented in the
      proposal, asserted in the tidy prompt string (all three locales).
- [ ] 4.2 No bridge-side auto-injection of pages into the turn: the wiki is
      read by tools (`/view`, `/find`, the tidy turn), never silently appended
      to a prompt. Stated as a spec requirement, tested by its absence in the
      turn args.

## 5. Git history

- [ ] 5.1 `ensureWiki()` runs `git init` when the tree is not a repository;
      commits stay manual or per-tidy-turn (the turn is told to commit after
      moving lines, in the locale prompt). Test: `git init` idempotence with a
      fixture tree.
- [ ] 5.2 `.gitignore` created once, ignoring `*.bak`. Test: created when
      absent, untouched when present.

## 6. Docs and locales

- [ ] 6.1 `docs/COMMANDS.md` regenerated; `/remember` row gains the wiki forms.
- [ ] 6.2 CHANGELOG bullet.
- [ ] 6.3 All strings in ru/en/zh; locale-shape test stays green.
