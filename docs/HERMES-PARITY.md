# DSH vs the Hermes agent — what parity would take

A research note, written 2026-10-28 against Hermes Agent v0.22.x and DSH
`0.2.1-rc.2`. Every non-obvious claim below was taken from the project's own
docs or repository; the numbers are page-reported and not audited.

## What Hermes Agent is

- `NousResearch/hermes-agent` — MIT, Python 3.14, installed by a shell or
  PowerShell one-liner; ships a TUI, a `hermes gateway` daemon, a desktop app
  and a web dashboard.
- Model-agnostic: Nous Portal, OpenRouter, OpenAI, Anthropic, local endpoints.
  It is a runtime, not a model — Nous' own docs say Hermes-4 is chat/reasoning
  and not tool-call-tuned.
- Agent loop: a Python `AIAgent` conversation loop with per-turn phases, a tool
  registry, `ThreadPoolExecutor` concurrent tool calls, provider failover,
  SQLite session state, preflight context compression at ~50%.
- Headline features: bounded memory files (`MEMORY.md`, `USER.md`) with periodic
  nudges, self-authored and self-improving skills, FTS5 cross-session search,
  built-in cron with delivery to any platform, isolated subagents, six execution
  backends (local, Docker, SSH, Modal, Daytona, Vercel), 20+ chat platforms from
  one gateway, batch trajectory export for RL.
- Sources: <https://github.com/NousResearch/hermes-agent>,
  <https://hermes-agent.nousresearch.com/docs/>.

## Where DSH is already ahead

- `workflow`: a JS orchestration script with phases, `pipeline`/`parallel` and
  JSON-schema-validated results. No documented Hermes equivalent.
- `subagent_fork` inherits the whole conversation; Hermes subagents are
  deliberately isolated.
- MCP **resources** and resource templates, not only tools.
- Profile patch-layer composition (`cordis.patch.yml` over ordered bundles)
  rather than per-profile directory copies.
- Telegram multi-topic threads with a session per topic, live progress cards and
  mid-turn steering — deeper than a single-topic gateway.

## Gaps, in the order they are worth closing

1. **Per-turn cost and token ledger** (S/M, core + bridge). Hermes exposes
   `/usage` on every surface. Without it nobody can budget an unattended turn.
2. **Approval buttons in chat** (S, bridge). Allow once / this session / always /
   deny as inline keyboards. Cheapest perceived-parity win available.
3. **Scheduler** (M, core + bridge). Recurring prompts, no-agent jobs, webhook
   triggers. Cron is Hermes' stickiest feature: unattended delivery into chat.
4. **Persistent memory and cross-session recall** (L, core). Bounded memory
   files plus full-text session search plus a `memory` tool. The largest durable
   gap: DSH has sessions, not memory.
5. **Self-authoring skills** (M, core). The hot-reload and catalog plumbing
   already exists; only the loop that writes a skill after a complex task is
   missing.
6. **Remote execution backends** (L, core). Docker/SSH/serverless is what lets
   Hermes live on a small VPS; DSH is desktop-bound.
7. **Provider breadth, failover chains, subscription OAuth** (M, core).
8. **Chat parity for features the core already has** (S each, bridge): plan
   mode, plugin settings, inline command hints.
9. **Trajectory export and an eval harness** (M, core, strategic).
10. **A web dashboard with analytics** (M, core).

## Caveats

- Hermes' plan-mode, telemetry and dashboard arrive as **plugins**, not core; a
  core-only comparison is less lopsided than a feature table suggests.
- No official benchmark claims were found for either side. Do not assume one is
  better at tasks; the differences documented here are about surfaces and
  durability, not answer quality.
- The recommendation would change if DSH's roadmap already covers memory and
  scheduling — those are the only two structurally hard items.
