# Design: the permission model, as the host actually implements it

Everything below was observed on a live profile with `dsh --patch`, not read off
a docs page. Each claim names the experiment that produced it.

## Two rows that look like one

```
- id: sandbox-policy            ← mode + workspaceRoot
  name: '@deepseek-ai/dsh-sandbox-policy'
- id: permission                ← presets + defaultPreset
  name: '@deepseek-ai/dsh-permission-presets'
```

It is natural to read the first as the setting and the second as a menu of
alternatives. The experiments say the opposite: **`defaultPreset` is what the
turn runs under, and the `sandbox-policy` row is overwritten by it at boot.**

| Patch under test | `sandbox-policy.mode` | `defaultPreset` | A write outside the root |
| --- | --- | --- | --- |
| A | `read-only` | `danger-full-access` | **succeeded** |
| B | `danger-full-access` | `read-only` | **denied**: `[sandbox: file access denied under read-only mode]` |
| C | `workspace-write` | `workspace-write` | denied outside, allowed inside |

Experiment A is the one that matters. A profile that says `read-only` in the row
a reader would call "the sandbox setting" still wrote
`<home>\sandbox-probe-outside.txt`, and the turn's own system prompt
reported the session policy as `danger-full-access`. The permission service
wins; the sandbox row is a default for a profile that has no permission table.

The live profile has both set to `danger-full-access`, so nothing contradicts
nothing — which is exactly why the bug was invisible.

## `workspaceRoot` is the boundary, and it holds

With `workspace-write` and `workspaceRoot: .../dsh-tg-bridge-oss`:

- writing inside the root: allowed, no prompt;
- writing `.../latvian-b1/outside-probe.txt`:
  `[sandbox: file access denied under workspace-write mode]`;
- calling `working-directory` to switch the turn to `latvian-b1` and then
  writing there: the switch reports OK, **the write is still denied**. The
  boundary follows the configured root, not the turn's current directory.

That last row is the answer to "the model wanders into another project": with
the root set per topic, a wander is a refusal, not a write.

## Approval is unavailable in a headless turn

With `approval: ask`, an out-of-root write fails closed:

```
Error: sandbox escalation to "danger-full-access" requires approval,
but no approval channel is available
```

A headless turn has nobody to ask. So `ask` is not a middle setting in Telegram
— it is a synonym for "deny, with a longer error". The only honest choices in a
chat are a preset that needs no approval, or a button that answers the prompt.
That is why the per-topic preset (task 31) and the approval card (task 23) are
one feature, not two: without the card, `ask` is a dead option, and without the
preset, the card has nothing per-topic to switch.

## So what `/permissions` does today

`cmd-agents.mjs:255` reads the preset table of the **profile**, lists it, and
writes `defaultPreset` into that same profile. Because `defaultPreset` is the
effective knob, the command works — but it works on *every topic at once*, and
the reply says so. That is a real command with a real effect and the wrong
scope.

## The shape the bridge should have

```
topic ──bind──► workspace (a directory)      ← /cd, tested per platform
  │
  └──preset──► (sandbox, approval)           ← per-topic, derived profile
                 │
                 └─ sandbox-policy row rewritten to the same mode,
                    workspaceRoot = the bound directory
```

Both rows must be written together, because a reader — and the boot sequence —
will believe whichever one it looks at. A derived profile that sets only
`defaultPreset` leaves a `sandbox-policy` row claiming something else, and the
next person to debug this reads the wrong row, as I did.

## Failure directions

| Failure | Must do |
| --- | --- |
| derived profile cannot be written for a narrower preset | refuse the turn, name the preset |
| derived profile cannot be written for a wider preset | run the base preset and say the wider one did not apply |
| bound directory missing | refuse, name it (today: silent fallback to `config.cwd`) |
| `defaultPreset` names a preset the table lacks | refuse at boot, not at the first tool call |

## Non-goal: `ask` without a channel

Shipping `approval: ask` in a headless profile produces a permission system that
can only say no. Until a turn can put a button in the chat, the bridge offers
`read-only`, `workspace-write` and `danger-full-access`, all with `never`, and
says in one line what `danger-full-access` means.

## What the profile says now, and what it should say

```
today                                   after
mode: danger-full-access                mode: workspace-write
workspaceRoot: <home>                   workspaceRoot: <the topic's project>
approval.policy: never                  approval.policy: never
defaultPreset: danger-full-access       defaultPreset: workspace-write
```

The two rows must agree. If only `defaultPreset` moves, the file lies; if only
`sandbox-policy` moves, the file is ignored. Both, or neither.
