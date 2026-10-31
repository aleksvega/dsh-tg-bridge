# What a turn did, while it is doing it

## Why

The chat shows a progress line while a turn runs and a statistics line after it,
but neither answers the two questions a person actually has on a phone: how far
along is this, and who is doing the work. A turn with five subagents looks
identical to a turn with none — one line that says "thinking".

The desktop app answers both with a panel. The chat answers them with a wall of
text after the fact, and the numbers that matter (time, tokens per second, cache,
cost) are read from a log rather than from the message.

## What changes

1. **A turn card after the answer.** Time, tokens per second, cache hit, sum and
   balance, drawn as a small card rather than a paragraph, with the blocks the
   person chose. The choice is per topic and survives a restart.
2. **A subagent panel while the turn runs.** One row per subagent: what it was
   asked, how long it has been running, and its tokens. Updated on a throttle, so
   a fast turn does not produce a message per delta, and removed when the turn
   ends.
3. **A block that cannot be measured is not drawn.** An unknown cost is not
   `$0.00`; an unknown balance is not a zero.

## Non-goals

- No chart, no history, no per-tool breakdown.
- No change to how a turn is spawned or how usage is collected; this is what the
  chat shows.
- No subagent control: the panel reports, it does not stop or steer.

## Definition of done

1. The turn card renders every block it offers in all three locales, and a test
   asserts no raw key and no unknown value rendered as zero.
2. The block selection round-trips through `saveState` and is read back on the
   next turn.
3. The subagent panel is asserted by a test with a synthetic event stream: one
   row per subagent, one edit per throttle window, and nothing left behind when
   the turn ends.
4. Both surfaces answer within the quiet-guard window, and the panel never blocks
   the turn.

## Impact

- **Users**: less text, and two questions answered while they matter.
- **Maintainer**: one card and one throttled editor, both following the shape the
  progress line already uses.
- **Risk**: an edit per event would rate-limit the bot. The throttle is the
  feature, not an optimisation.