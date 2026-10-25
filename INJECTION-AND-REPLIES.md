# Injecting into a running turn and composing replies in Telegram

Date: 24.10.2026. Source: DSH code in `app.asar`, bridge code in `~/.dsh/tg-bridge`, Hermes behaviour.

## Part 1. What "injecting into an already running prompt" means

The agent runs a turn: model -> tool -> model -> … While the turn is running, the user may
want to (a) add a clarification the agent sees **in the same turn**, or (b) put a message
**in the queue** for the next turn, or (c) **interrupt** the turn and replace the task.

These are three different modes and must not be confused: "add to queue" and "intervene" give different UX.

### How DSH does it (fact from the code)

`@deepseek-ai/dsh-api-session-controller`, `lib/client.js`:

```js
const placement = this.running
  ? input.mode === "steer" ? "steering" : "queued"
  : "transcript";
// mode: queue — appends after the current turn; steer — interrupts it.
```

So DSH **already has** the mechanism:
- `prompt(input, { mode: "queue" })` — the message joins the session queue, the turn is left alone;
- `prompt(input, { mode: "steer" })` — the message is delivered into the **running** turn (steering),
  the model sees it at the next step boundary;
- `cancel()` — cancels the turn; `interruptByParent()` — interrupts a child session.
- The queue lives in session state and survives client reconnects (queue mutation,
  receipts, dedup by `requestId`).

Limitations (from the same code):
- queue and steer are accepted only for a **live** session; for a "cold" one, prompt creates/
  resumes a session and that is ordinary input, not an injection;
- steer does not "append" to history, it cuts into the current turn — aborting it too
  roughly loses tool work, so cancel and steer are distinct operations.

### Why the current bridge has neither

The bridge drives `dsh --profile headless --json "text"`: one CLI process per turn, no live
session between turns, and the CLI has no channel to "append to the active turn" (`--help` shows only task /
`--json` / `--session-id`). A message that arrives mid-turn simply joins the bridge queue
(`enqueue`) and starts **after** the previous one finishes.

### How to add injection to the bridge

1. Move to the API transport: `@deepseek-ai/dsh-api-client` / `dsh-api-gateway`
   (`/api/remote.mux`), methods `session.prompt({ mode })`, `session.cancel()`.
   The bridge then keeps one live session per topic and can:
   - `mode: "queue"` — the usual queue (current behaviour, but without restarting the CLI);
   - `mode: "steer"` — deliver a clarification into the running turn.
2. In Telegram this shows up as buttons under the status: "⏹ Stop" (cancel), "➕ Into turn" (steer),
   "🕘 To queue" (queue). Default is queue, as now.
3. Until the API transport exists, a cheap compromise: mark such messages in the chat as
   "accepted, will add to the current turn" and still run them afterwards (do not pretend to steer).

## Part 2. How Hermes composes a reply in Telegram

The scheme for one turn:

1. **Status message** is created once: `⏳ Working… 42 s`, with the latest steps below
   (`• terminal: npm test`, `• read: src/app.ts`). Updates go through `editMessageText`, no more often than every 1.5–2 s
   (Telegram limit ~20 edits/min per chat).
2. **Heartbeat**: if no events arrive for 2 minutes, the status is still redrawn — the time
   counter changes. That is the "I can see it is alive" signal, not "hung".
3. **Intermediate model text** (if the model said something before the final answer) goes on a
   line `• text: first 120 characters` — you see the reasoning, without a wall of text.
4. **The final answer replaces the status**: `✅ Done · 1:12 · 6 steps`, below it the answer itself in HTML
   (code in `<pre><code>` with a "copy" button), then the line `🧠 cache: 97%`.
5. **Error** — the same status turns into `⚠️ Turn failed · 9 s` + code and hint
   (`TG_CONFLICT`, `SANDBOX_DENY`, `INSUFFICIENT_QUOTA`), rather than a separate message.
6. **Queue**: if a second message arrives during a turn, a short `⏳ queued (2)`,
   and the first message is not lost when the turn completes.
7. **Buttons** (where enabled): "Stop" under the status, "Retry" under an error, "Send file"
   after a turn, "Allow/Deny" for approvals.
8. **Limits handled**: 4096 characters per message (a long answer is split at code block
   boundaries), `message is not modified` is ignored, `retry_after` from 429 is respected.

What the DSH bridge already has of this: status with steps and heartbeat, HTML blocks, queue,
fail-fast on quota. What it lacks: buttons, streaming of the final text, error codes in the message.

## Practical takeaway

- Injection in DSH is implementable **without modifying DSH itself** — it already knows `queue` and `steer`;
  it only needs a transport (API instead of CLI) and two buttons in Telegram.
- Estimate: API transport + steer — 2–3 days, and the same transport gives approvals and files without workarounds.
- Until the transport is done, it is more honest to keep the queue and not promise "I'll cut into the current turn".
