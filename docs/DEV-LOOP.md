# How work continues without a person at the keyboard

This file describes the loop that runs this repository when the owner says
"continue until it is done". It is deliberately made of things the repository
already has, because an orchestration layer that keeps its own copy of the truth
drifts from the truth.

## Three places hold the state

| Where | What it answers | Who reads it |
|---|---|---|
| The task list in the Telegram topic | What is the plan, and what is already done | The person, while the work runs |
| `openspec/changes/<change>/` | What does "done" mean, in scenarios | Me, before writing code |
| `git` + the test suite | What is actually true right now | Everyone, after |

Nothing else is authoritative. A progress file that disagrees with `git log` is a
lie with good formatting, and the tests are what decide whether a task is
finished.

## One round, one task

A round starts by taking the first unfinished task and ends with it committed.

1. **Read the acceptance criteria.** If the task has an OpenSpec change, its
   requirements are the definition of done. If it does not, write the change
   first — a task whose "done" is a feeling produces a feature nobody can check.
2. **Write the test that fails.** For a bug, the test must fail on the previous
   revision for the right reason. For a feature, it fails because the code is
   missing. This is the step that catches the failures of the past: two cards
   shipped dead for four releases while the suite was green, because no test
   called the wiring a real tap travels.
3. **Implement the smallest thing that passes.** No dependency, no module over
   500 lines, no second spelling of an existing rule.
4. **Three locales in the same commit.** `en`, `ru`, `zh`, read from the topic's
   language, and a key whose consumer is gone is deleted from all three.
5. **Run the whole suite**, not the file that changed:
   `node --test test/*.test.mjs` from the repository root with `DSH_HOME` unset.
6. **Commit, then sync.** `node sync-runtime.mjs` from the repository root, so the
   live install carries the same bytes as the commit.
7. **Tick the task** in the topic list, so the plan moves while the person
   watches instead of after they ask.

## What stops the loop

- **A decision that belongs to the person**: publishing a version, enabling a bot
  mode in BotFather, deleting data, spending money. The loop asks once, in one
  line, and waits.
- **A blocker that survived three rounds.** Retrying the same failing approach is
  how a loop burns a day; the third failure is a report, not another attempt.
- **A failure it cannot explain.** An unexplained red test is not "flaky" until
  the second observation of the same cause.

## What the loop refuses

- A test weakened to reach green: `.skip`, a deleted assertion, a narrowed
  expectation. The bar is in `openspec/changes/2026-10-31-acceptance-bar/`.
- A claim without a measurement. A provider that "works" names the status code and
  the latency that were observed.
- A feature that adds a runtime dependency.

## How this differs from an orchestrator-style loop

Orchestrator projects (Myriad Loop's `Bard`, and the family it belongs to) run a
separate process that reads a `memory.json`, splits the spec into features, and
delegates to architect, implementer and QA subagents with a retry cap. The three
good ideas there are worth keeping and are kept here:

1. **Explicit state that survives an interruption.** Here it is the topic task
   list plus `git`, and a persisted goal with a round budget is what keeps the
   session working across rounds.
2. **Roles that are not the same context.** The implementer should not be the only
   reader of its own work; here the second reader is the test suite and, for
   anything risky, a separate reviewer pass.
3. **A retry cap.** Three attempts, then a report — not an infinite loop.

What is deliberately different: the orchestrator's memory is a second copy of the
truth, and a second copy drifts. Here the QA role is not another model's opinion
that the change "looks good" — it is `node --test`, which cannot be talked out of
a failure. That is the whole reason this loop is cheap: the expensive part of an
orchestrated loop is not the orchestration, it is re-litigating "is it done".
