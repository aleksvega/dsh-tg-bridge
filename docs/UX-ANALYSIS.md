# UX analysis of the DSH Telegram bridge (no implementation)

Date: 23.10.2026. Based on the live code in `~/.dsh/tg-bridge` and Bot API responses.

## 1. Facts

- Commands **are registered**: `getMyCommands` in the default scope returns 18
  (`new cd status stop prices send seed sessions resume models model skills soul plugins plugin app restart help`).
  There are no separate scopes for chats/groups — the default works and is sufficient.
- The code has 18 handlers; an unknown `/command` **gives no hint** and goes to the AI as ordinary text.
- There are no inline buttons at all: `reply_markup` — 0 occurrences, `callback_query` — 0. So there is no
  "Stop" button, no "Retry", no "Send file", no confirmations.
- A status message exists: created per turn, edited (tools, text, time counter, cache in the final state).
- A typing indicator exists (refreshed every 4.5 s).
- The answer arrives whole at the end: intermediate model text is visible only as the line `• text: …` in the status.

## 2. What is worth porting from Hermes (by decreasing value)

### P0 — noticeably changes the workflow
1. **Inline buttons + callback.** "Stop" under the status, "Retry" under an error,
   "Send file" after a turn, "Allow / Deny / Always" for approvals.
   Right now all of this is text only.
2. **Unknown command is not a turn.** Today `/fuck` starts the model. It should be:
   "No such command" + menu. That also saves money.
3. **`/doctor` and `/logs <code>`.** Diagnosis in one command: pid, getMe, 409, sandbox, model, disk.
   Without it every failure turns into a back-and-forth chat.
4. **Answer streaming.** Edit one message as generation proceeds (throttled to 1.5-2 s),
   instead of delivering a finished block 4 minutes later. Telegram allows ~20 edits per minute per chat.

### P1 — comfort
5. **Queue with a "Cancel" button**: "queued (2), cancel" instead of silence.
6. **Turn summary**: time, steps, tokens, cache %, cost. Today only cache is shown.
7. **Auto artifacts**: if a turn created files — "send" buttons.
8. **Missing commands**: `/compact`, `/retry`, `/cost`, `/find <text>` across sessions,
   `/rename` a topic, `/pin`.
9. **`/help` by groups**: "work", "sessions", "models", "diagnostics" — 18 lines in a row are hard to read.
10. **Errors with code and hint**: `SANDBOX_DENY`, `DSH_SPAWN_FAIL`, `TG_CONFLICT`, `SESSION_CWD`.

### P2 — polish
11. Voice replies (TTS) as an option — for long explanations.
12. `/stats`: how many turns, average duration, error share over a week.
13. A setting "show model text" / "tools only" — for some, it is noisy.
14. Auto-rename a topic after the first task (as in Hermes), with confirmation.

## 3. Telegram limits that cannot be worked around

- 4096 characters per message → already split into parts; status edits must stay within one message.
- ~20 edits per minute per chat → throttling is mandatory (currently 3.5 s — 1.5-2 s is possible).
- Inline keyboard: up to 64 buttons, but on a phone at most 4-6 are readable.
- In groups commands work, but the menu is shown from the default scope; separate scopes are not needed.

## 4. What is already good and should be left alone

- Journal + ack + replay; two-phase restart; setup/kick lock; a single poller.
- Status message with steps and cache; typing; IPv4 fix; HTML code with copy.
- `/cd` to a project + sandbox, `/send` and document intake, `/prices`.

## 5. Conclusion

The gap with Hermes is not in commands (they exist) but in **interactivity**: no buttons and callback,
no answer streaming, unknown commands go to the model, no diagnostics.
The four P0 items close 80% of the "works like Hermes" feel.
