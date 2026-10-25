# DSH ↔ Telegram: roadmap

Updated: 2026-10-23. History: `CHANGELOG.md`; UX analysis: `UX-ANALYSIS.md`.

## Done (22–23.10)

- Turn journal + ack + replay; two-phase restart; per-minute supervisor; setup/kick lock.
- A single poller; pid file; process lookup by pid instead of by the empty cmdline of an elevated process.
- 18 commands with one shared list; `/cd` (project per topic), `/prices`, `/send`, `/sessions`, `/model`.
- Files in both directions; incoming documents in `inbox/`.
- `workspace-write` sandbox + explicit preset; verified: `C:\Windows` is closed, the project is open.
- Progress: one status message, steps, model text, cache; heartbeat every 2 min.
- Timeouts: no hard ceiling, silence does not kill a turn.
- Network: IPv4 forced, polling backoff, error codes.
- Fallback: free-model chain from `fallbackModels` in `config.json`; message "balance exhausted — running on X (free)".
- Subagents: per-profile `agentOptions` model override.

## P0 — next (stability and control)

| # | Task | Acceptance |
|---|---|---|
| 1 | `/doctor` + `/logs <code>` | one command: PASS/FAIL for pid, getMe, 409, sandbox, model, disk |
| 2 | Fail-fast on 403/quota | with an exhausted balance, switch immediately, without a 20-minute turn |
| 3 | Unknown command → menu | `/abc` does not start the model and does not spend money |
| 4 | Approvals via buttons | deletion inside the project waits for "Allow/Deny"; a denial = fail-closed |
| 5 | "Stop"/"Retry" buttons | pressing stops the turn; "Retry" reruns the same prompt |

## P1 — parity with the UI

6. Stream the answer by editing the message (throttle 1.5–2 s).
7. Turn summary: time, steps, tokens, cache, cost, model (including a fallback to free).
8. Queue with "Cancel"; `/compact`, `/retry`, `/cost`, `/find`, `/rename`.
9. Worktree: wrapper for `git worktree add .worktrees/<name>`, diff to the chat.
10. Model health probe once an hour → `models-health.json`, warning on degradation.
11. Auto artifacts: a turn created a file → "send" button.

## P2 — product and open source

12. Config instead of hardcoding (user id, paths, language, limits).
13. Installers: Windows (schtasks+VBS), macOS (launchd), Linux (systemd --user).
14. i18n `en`/`ru`, `/lang`.
15. JSONL logs with stable codes and hints.
16. Public repository: README EN, MIT, CI on three OSes, screenshots.

## Risks

- DSH internal API is not a public contract → version gate and CLI fallback.
- Approvals without an answerer = fail-closed: the plugin ships together with the bridge.
- Free providers are unstable (503 capacity) → need a chain, not a single model.
- `create_worktree` does not work on this machine until the PATH fix.
