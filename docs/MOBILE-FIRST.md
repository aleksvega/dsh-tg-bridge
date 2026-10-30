# Working from a phone

Updated: 2026-10-30. Companion to `ROADMAP.md` (which is older and narrower) and
`CHANGELOG.md` (what shipped).

The goal this document serves: **100% of development happens from a smartphone,
about 80% of it by voice**, with the agent, the repo and the shell on a server or
a home machine. Every item below is judged by one test — does it work one-handed,
from voice or two taps? Anything that assumes a desktop is out.

Prices are per-item and are the *user's* cost to run, not the cost to build.
Effort is for one maintainer: **S** ≤ 1 day, **M** ≤ 4 days, **L** > 1 week. The
project ships `dependencies: {}`, so anything that needs an npm dependency is
flagged and refused.

---

## 1. What desktop users actually do

Desktop harnesses win on four things a Telegram chat structurally lacks:
selection-aware context, line-level diff review, rewind, and parallel visibility.
What people actually run, by frequency:

| Feature | Workflow | Frequency |
|---|---|---|
| `/ide` — pull the open file and the current selection into the prompt | "fix this function" without naming the file | many×/hour |
| Inline diff review before accept | reject one hunk, keep the rest | many×/hour |
| Rewind and checkpoints | undo a bad turn without git surgery | daily, at the worst moment |
| Branch / fork / subagents | try two designs; delegate a side task | daily |
| Tool hooks that can block | enforce lint and permission policy mechanically | set once, fires constantly |
| Repo map + explicit file scoping | keep a large repo inside the window | every turn |
| Background agents that outlive the app | lock the phone, come back to a result | daily |

Two of these are **not** desktop-only and are missing here: **line-level diff
review** and **selection context**. The bridge is already ahead of most
competitors on session plumbing (`/rewind`, `/plan`, `/skills`, `/plugins`, cost
and context meters, goals and tasks per topic, i18n) and behind on the two things
people touch every few minutes.

## 2. What breaks when the only device is a phone

| Breaks today | Why | Highest-leverage single fix |
|---|---|---|
| Long output | 4096 characters per message, then a wall to scroll | rich message (32 768 chars) with collapsible blocks, else a `.md` file |
| Diffs | monospace wraps unreadably past ~40 columns on a 6" screen | per-hunk buttons over a truncated unified diff |
| File review | no usable picker, no memory of where you were | `/ls` card + `copy_text` on the path + "last 20 lines" |
| Approvals | every tool call asks, and the person is walking | approval memory with a TTL, plus "approve the rest of this turn" |
| Keyboard-hostile flows | typing a path, a branch or a regex on a phone | voice and buttons; never require typing a path |
| Notification fatigue | progress pings the phone | one edited card per turn (already done) + silent progress |
| Session switching | `/sessions`, then read a list | a pinned status card per topic, plus a reaction as a state dot |

## 3. The 80/20 list

Ranked by value to a phone-only user over cost for one maintainer. Cost column is
what the *person* pays to run it, at DeepSeek Flash off-peak rates ($0.15/1M input
cache-miss, $0.003/1M cache-hit, $0.60/1M output; peak is 2×).

| # | Feature | Why it closes the loop | Effort | User cost |
|---|---|---|---|---|
| 1 | **Diff card with per-hunk buttons** — one rich message, one `<details>` per file, a keyboard row per hunk: *keep / revert / explain / rewrite* | the one thing that makes "review my change" possible from a phone | M | $0 extra (~$0.004–0.01 per turn) |
| 2 | **Voice → confirm card → run**, with a ≤200-character spoken summary back | 80% of the work is spoken; the card is what makes a risky voice command safe without typing | M | local speech-to-text $0; cloud transcription ~$0.001 per 15-second note; local TTS $0 |
| 3 | **One-action test loop** (`/fix`) — run the suite, feed the failures back, iterate ≤3, one summary card | kills the read-paste-rerun cycle, which is brutal on a phone | S | ~$0.02–0.05 per run |
| 4 | **`copy_text` buttons** for paths, hashes and commands | one tap instead of long-press-drag on a 6" screen | S | $0 |
| 5 | **Long output that does not flood** — rich message with folding, else the answer as a document | 4096 characters is a hard wall | S | $0 |
| 6 | **Approval memory** — "allow this tool here for 1 hour / always / deny" | approval fatigue is why phone-driven agents get abandoned | S | $0 |
| 7 | **Scheduled agents and a morning digest** — `/every 08:00 mail triage`, `/jobs` to check | the shape that actually justifies a phone | M | ~$0.02–0.10 per day |
| 8 | **Per-topic daily budget with a hard stop** | an unattended agent needs a spend fuse before it needs features | S | saves money |
| 9 | **File browse and upload from the topic** | 20 MB download cap, 50 MB upload cap | S/M | $0 |
| 10 | **Mini App diff viewer** | the last 5%: tapping hunks in a big diff | L | $0 hosting on a static host + a free tunnel; ~$6/month if the agent moves to a VPS |

### Tasks for the top four

**1. Diff card with per-hunk buttons** (M)
- collect the turn's `git diff` from tool results, not from a shell call at the end;
- split into hunks, hash each into a ≤64-byte callback id;
- render one rich message with a 32 768-character guard and an explicit truncation notice;
- wire the callbacks to a scoped "apply this hunk" / "revert this hunk" prompt;
- fall back to a paginated `<pre>` where rich messages are unavailable;
- tests: hunk ids are stable, the truncation notice is honest, callbacks survive a restart.

**2. Voice-first loop** (M)
- show the transcript as a card *before* dispatch, with *Run / Edit / Cancel*;
- mark destructive transcripts with a distinct danger-styled button;
- send the summary back as a voice bubble, capped at one per turn;
- `/voice off | short | full`;
- reuse the existing load guard before spending CPU on transcription.

**3. One-action test loop** (S)
- detect the project's test command;
- cap iterations at three and each run at a budget;
- one summary card carrying the diff, plus a stop button;
- record the failing test names in `/tasks` so they survive the turn.

**4. `copy_text` buttons** (S)
- one helper that turns a value into a copy button, used by every card that shows a path, a hash or a command;
- keep the visible text short and the copied text exact.

## 4. Voice as the primary input

Telegram delivers voice notes as `voice` with a reusable `file_id`. Local
transcription (`faster-whisper`, `whisper.cpp`) is free but costs 75–500 MB of
model and roughly 0.4–2.5 GB of RAM; cloud transcription is about $0.0043/minute
(Deepgram Nova-3) or $0.0048/minute (Whisper Large), i.e. ~$0.001 for a
15-second command. A transcript has to appear in under ~2 seconds or people
re-record.

Spoken output is worth it for *status* and not for anything that may need
copying: a one-to-three sentence summary as a voice bubble beats a paragraph
while walking. Local TTS (`piper`, `espeak`) is free; hosted TTS is roughly $0.008
per 200-character summary.

## 5. Always-on agents

The Bot API has **no** scheduling parameter — the bot must own a timer, so
crash-safe persistence and a catch-up-on-boot policy are the real work. What the
bridge needs beyond the existing `/every`:

- jobs survive a restart, and a job missed while the machine was off is either
  run once on boot or explicitly skipped, never silently dropped;
- a per-job budget cap with a hard stop;
- one digest card instead of N messages;
- `/every pause`, `/every rm`, and a `/jobs` view with next run, last result and spend.

## 6. Telegram-native surfaces worth using

The most consequential constraint: **`web_app` buttons work in private chats
only**, so a Mini App cannot be opened from inside a forum topic — it needs a DM
or a `t.me/<bot>?startapp=` deep link, which works anywhere.

- **Rich messages** — 32 768 characters, 500 blocks, collapsible `<details>`,
  tables. This is the whole reason the diff card is a day of work rather than a
  hosting project.
- **`copy_text` buttons** — 1–256 characters. Cheapest win available.
- **Ephemeral messages** — a group message visible to one person. The right
  surface for approvals inside a shared forum.
- **Topics** — rename a topic to the running task, close it when done, colour it
  by state. Free session UX.
- **Polls** — a native surface for "which of these three do you want", without
  squeezing options into a 64-byte callback.
- **`sendChatAction`** — 5-second TTL, cleared by any message; re-send every ~4 s
  during a long tool call.
- **`deleteMessages`** — 1–100 ids per call; keep a topic readable by cleaning up
  intermediate cards.
- **Editing** — no published cap, but 1 message/s per chat and 20/min in groups,
  and an identical re-render returns 400 `message is not modified`, which is not
  a fault. The one-card-per-turn design is right; add a content hash and back off
  on 429.

## 7. The diff viewer, honestly

Ordered by cost, cheapest first:

1. **Rich message with folding and per-hunk buttons.** No hosting, no TLS, no NAT,
   works inside topics, survives going offline. This is 80% of the value for 5%
   of the effort, and it is item 1 of the 80/20 list.
2. **A Mini App** for the cases a message cannot hold: a static page, `initData`
   validated by recomputing the HMAC with the bot token and comparing in constant
   time, `auth_date` freshness checked, the Telegram user id mapped to an allowed
   id. It has to be served over HTTPS with a valid certificate.
3. **A local instance plus a tunnel** only if the Mini App proves necessary. The
   hard parts are not the page: CGNAT kills port-forwarding outright, a tunnel URL
   changes per run unless there is a domain, and an endpoint that applies patches
   is remote code execution by design — it must be bound to a signed user id, a
   per-session token, a size cap and a rate limit, and it must expose a narrow
   queue the agent polls rather than the agent's own port.

An image-rendered diff is the wrong answer: not selectable, not searchable, and it
needs a rasteriser the project will not take as a dependency.

## 8. The plugin system

The bridge already has a `plugin/` directory with `steer-inbox`. What makes a
plugin surface genuinely useful, in the order it matters:

**Manifest.** `id`, `version`, `engines.bridge` (a semver range), `contract` (an
integer, refused on mismatch), `capabilities`, a config schema, and `secrets` as
*names only* — the host resolves them and injects them, never into the agent's
context.

**Lifecycle.** `preTurn`, `postTurn`, `preToolCall` (the only one that may block),
`onApproval`, `onError`, `onRelease`. The split that works, and that OpenCode
already models: **middleware** for `preToolCall` — ordered, may block, may rewrite
arguments — and a fire-and-forget **bus** for everything else. Declare, per hook,
whether it can block, as data rather than as prose.

**Failure isolation, which is the whole point.** A release of this bridge once
threw on its first turn; a plugin must not be able to do that. Every hook call
wrapped in `try/catch` with a per-hook timeout (2 s before a turn, 10 s after),
and a per-plugin circuit breaker — three failures and it is disabled for the
session, announced in the chat with a one-tap re-enable. Anything touching the
filesystem or the network runs in a child process, not in the host. `node:vm` is
not a security boundary and the docs must say so.

**What to copy, and what to avoid:**

| System | Copy | Avoid |
|---|---|---|
| Claude Code plugins | a documented can-block flag per hook — capability as declared data | loading by directory convention, so behaviour depends on which files happen to be present |
| OpenCode | a plugin is a function returning a hook map plus a disposer; multiple plugins per hook run in a defined order | telling users to install third-party packages into the host at startup |
| MCP | capability and protocol-version negotiation at handshake; unknown capabilities refused | treating it as a lifecycle — it has no pre-turn or approval slot |
| VS Code | the extension host in its own process: a bad extension dies without taking the workbench | letting the "narrow API" promise erode as the surface grows |
| Home Assistant | declarative dependency ordering, validated by CI | installing requirements at runtime |

**The first three plugins**, chosen to prove the system rather than to demo it:
`diff-review` (post-turn rendering plus callback routing — it also ships item 1 of
the 80/20 list on day one), `approval-policy` (the one hook that can stop the
agent, plus TTL rules and "safe to run unattended"), and `cron-digest` (a plugin
that owns a background loop, holds a secret and spends money under a cap).

## 9. Roadmap

Ordered. Effort and user cost as above.

1. **Diff card with per-hunk buttons** — product, M, $0 extra.
2. **Voice-first loop with a spoken confirmation** — product, M, $0–0.001 per note.
3. **One-action test loop** — product, S, ~$0.02–0.05 per run.
4. **`copy_text` everywhere** — product, S, $0.
5. **Approval memory and ephemeral approval cards** — product, S, $0.
6. **Budget fuse and cost card** — product, S, saves money.
7. **Scheduled agents and a morning digest** — product, M, ~$0.02–0.10 per day.
8. **Plugin host v0: manifest, hooks, failure isolation** — platform, L, high risk.
9. **Publish the plugin contract and the three reference plugins** — platform, M.
10. **Mini App diff viewer, opt-in and DM-only** — product, L, high risk; ship it
    after item 1, as an upgrade, never as the only path.

## 10. Where the competition stands

Checked 2026-10-30, stars from the GitHub API.

| Project | ★ | Has that this bridge does not |
|---|---|---|
| `chenhg5/cc-connect` | 16 172 | multi-platform, multi-agent, a web UI for config, OS-user isolation, scheduled tasks |
| `overwirehq/claude-code-telegram` | 2 819 | GitHub webhooks, a built-in cron scheduler, cost-based rate limiting, audit logging |
| `grinev/opencode-telegram-bot` | 1 298 | a pinned live-status message, worktree switching, a file browser, queue-versus-steer |
| `littlebearapps/untether` | 74 | per-run and daily budgets with stop-at-limit, one-shot `/at 30m` runs, webhooks |
| `etcircle/cc-telegram` | 0 | multi-select question toggles, permission cards with TTL rules |

What none of them have: diff review that works on a phone, a voice-first confirm
loop, or a plugin surface for the bridge itself — and none of them ship with zero
dependencies. That is the space this project can own.
