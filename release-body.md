- **`/subagents` — the panel the turn card could not keep.** The live panel showed
  each subagent while a turn ran, and forgot it the moment the turn ended, because
  the rows lived in a closure. The bridge now keeps the last 24 runs per topic in
  its state and prints them on demand: the task each was given, how long it took,
  and a mark on the ones that failed. A subagent still running when the turn ends
  is listed without a duration rather than with the time the turn happened to stop.
  The card also says what it cannot show — the headless host reports no tokens per
  subagent, so it does not split the turn's count. `/subagents clear` forgets them.
  Three locales.

- **`/cost` stops promising a fetch it never made.** With no price catalog on
  disk the card said "run `/cost` again to fetch one", and `/cost` only ever read
  the file: `/prices` is the one command that touches the network. The sentence
  now names `/prices`, and a test keeps it that way in all three locales.

- **The plugin activates again in a live host.** Cordis answers only for the
  services an entry declares in `inject` and throws on the rest, so the
  `workspaceRegistry` read in `apply` failed with "cannot get property
  workspaceRegistry without inject": the entry never activated and the bridge was
  never started. The read is guarded now, and a scratch profile booted with a live
  DSH shows the entry activating and the bridge child polling.
