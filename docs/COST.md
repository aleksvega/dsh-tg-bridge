# API spend: what was measured and what was configured

This document is about money, not features. All figures come from a live
install on Windows (DSH 0.2.1-rc.2, one hosted route, model
`deepseek-v4.1-flash-1017`), not from theory.

## What it was

- A single turn in Telegram ended with a request for **485,284 tokens**, cache
  hit rate — **24%**.
- A turn that called no tools at all still sent **477k**: history is not reset between
  messages, every new question pays for the whole topic context again.
- A session of 113 turns accumulated 181.9M uncached tokens and 188.4M cache
  reads.
- Route rates (from `cost-meter/ledger.json`), per 1M tokens:
  miss $0.15, hit $0.003, output $0.6.

The arithmetic for one message at 485k and 25% cache:

```
364k * $0.15/M  = $0.0546
121k * $0.003/M = $0.0004
                  ------
                  $0.055 per message
```

A turn with 10 tool steps = 10 such requests, i.e. ~$0.5. With a balance of
$0.005 that is "out of money" after the first long turn.

The cause is not the model but the compaction threshold: the route declares a
window of **1,048,576** tokens and the default threshold is `0.8` of the window, i.e. **838k**. The
session never reached it, so history grew to ~640k and was paid for in full on
every step.

## What was changed

Both profiles, `cordis.patch.yml` (backups `.bak-20261024` next to it):

```yaml
- id: compaction-basic
  config:
    auto: true
    thresholdRatio: 0.12      # 0.12 * 1,048,576 = 125,829
    retainTokens: 24000
    headroomTokens: 65536
    maxTokens: 8000           # default 65k — summary too fat
- id: spill-policy
  config:
    maxInlineTokens: 4000     # was 12,500
- id: tool-result-pruner
  config:
    thresholdChars: 4096      # was 8192
    headChars: 2048
    tailChars: 512
```

- **headless** (Telegram): edit in `~/.dsh/profiles/headless/cordis.patch.yml`.
  Applies from the next message — the bridge starts `dsh` fresh on every
  turn, no restart needed.
- **desktop**: the same edit inside `preset-standard`. Applies after
  quitting and starting the app.
- `glm-5.3` (9 times more expensive than flash:
  $1.4/M input, $4.4/M output) and `qwen3.8-flash` were removed from the subagent
  model list; a subagent can no longer
  silently pick an expensive route.

A threshold of 0.12 of the window is ~105–120k tokens of an actual request (pressure in
`contextPressure` includes headroom for the answer). After compaction the context keeps
~32–40k: system+tools ~7k, summary up to 8k, verbatim tail 24k.

## Expected effect

| Scenario | Before | After |
|---|---|---|
| One request, worst case | $0.055 (485k) | $0.019 (126k) |
| One request, average | $0.055 | ~$0.010 (70k) |
| Turn with 10 steps | ~$0.5 | ~$0.1 |

That is 3–5 times less at the same quality: the whole task still fits in the window,
it just stops being resent in full fifty times.

## On caching: do not rely on it

Measurement: a new session, answering "ok" — 13,444 input tokens. The second turn in the same
session with the same prefix — 13,496 input, `cacheReadTokens` **absent**,
i.e. 0. The prefix was identical, the pause between turns was seconds — the cache still did not
hit.

Conclusion: cross-turn caching does not work on this route (the proxy hits different
upstreams), and the 24% in the log is hits within a single turn. So the only
controllable lever is context size, not "cache warming".

## Knobs if you want something else

- `thresholdRatio: 0.06` → compaction at ~63k: cheaper still, but history loses
  detail more often. `0.2` → ~210k: rarer, more expensive.
- `retainTokens` — how many recent tokens stay verbatim.
- `maxTokens` — summary ceiling; 8000 is enough for "what has been done".
- `/new` in a topic — start the topic over (a new project = a new topic, not
  a continuation of the old one).
- If the balance runs out: `config.json` has `fallbackModels` pointing at free
  `:free` models; they kick in on a quota error.

## How to verify

- `~/.dsh/tg-bridge/bridge.log`, the line `turn ok ... tokens=N cache=M%` —
  `tokens` is the size of the last request of the turn.
- `~/.dsh/storages/session_projcache/sessions/<session>.json` →
  `contextPressure.pressureTokens` and `contextWindow`.
- `/compact` in the chat — manual compaction (in the headless CLI it does not
  work as a command: it is sent to the model as ordinary text).

## Not done yet

- `/context` and `/cost` in the bridge (right now context size is visible only in the log).
- A warning in Telegram when a turn reaches 150k.
- Disabling unused tool groups: their schemas take ~6.1k
  tokens in every request, but against 100k that is already minor.
