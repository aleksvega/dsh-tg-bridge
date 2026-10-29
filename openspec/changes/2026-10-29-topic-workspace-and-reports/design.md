# Design: where a workspace ends and a permission begins

## The two knobs are not the same knob

`cwd` is where the process starts. `workspaceRoot` + `sandbox` is what it may
reach. The bridge has always set the first and inherited the second, and that
asymmetry is the whole bug:

```
cwd          = Projects/latin-bot      ← where the turn starts
workspaceRoot= C:/Users/bistr          ← what the turn may write
sandbox      = danger-full-access      ← and the mode ignores the root anyway
```

A model that decides `Projects/game/README.md` is "the file it needs" is not
misbehaving; it is using the permissions it was given. Fixing the prompt cannot
fix that. Only the pair `(sandbox, workspaceRoot)` can.

## What the host actually offers

Read from the shipped bundle (`app.asar`) and the live profile, not from docs:

| Row | Key | Values seen |
| --- | --- | --- |
| `@deepseek-ai/dsh-sandbox-policy` | `mode` | `read-only`, `workspace-write`, `danger-full-access` |
| | `workspaceRoot` | any directory |
| `@deepseek-ai/dsh-user-approval` | `policy` | `never`, and the interactive policies the desktop uses |
| `@deepseek-ai/dsh-permission-presets` | `presets.<id>.{sandbox,approval}` | a table; `defaultPreset` picks one |

The live profile currently pins `mode: danger-full-access` **and**
`defaultPreset: danger-full-access`. Two places agree on the widest setting,
which is why `/permissions` alone would not have narrowed anything: the row the
preset service reads and the row the sandbox service reads are different rows,
and the current patch sets both.

`provider api` values the host knows: `openai-completions`,
`openai-responses`, `anthropic-messages`, `google-generative-ai`. The bridge's
`providerFor()` only passes the value through, so a profile may already declare
any of them; no code change is needed to *use* an Anthropic-shaped route, only a
row in the profile.

## Where the per-topic decision lives

DSH has no per-topic override — one turn runs under one profile. So a topic's
workspace and preset are materialised into a derived profile, exactly as
`/crew` does for a model (`aset-profile.mjs`):

```
base profile  ──overlay rows──►  aset-<hash>/
  cordis.patch.yml               cordis.patch.yml  (sandbox-policy row replaced,
                                                    permission row replaced)
  node_modules ─────────────────► junction, same plugins
```

The derived name already hashes `permissions`, so adding `workspace` to the hash
material is enough for a changed directory to produce a different profile and a
stale one to be pruned by `pruneDerived`.

`turn.mjs` passes `cwd` independently. Both are needed: `cwd` for relative paths
and the session's identity, `workspaceRoot` for the boundary. A topic whose
`cwd` is outside its own `workspaceRoot` is a configuration error and must be
refused loudly at `/cd` time, not discovered mid-turn.

## The direction of failure

| Failure | Today | Must be |
| --- | --- | --- |
| overlay cannot be written | turn runs on base preset (wide) | turn refuses with one line naming the preset it could not apply |
| bound `cwd` deleted | silently falls back to `config.cwd` (`turn.mjs:39`) | turn refuses and says the directory is gone |
| `/cd` to a path outside the profile root | accepted | accepted, but the topic's `workspaceRoot` widens with it — and the chat says so |

The first row is the one that matters: a permissions feature whose failure mode
is "run unconfined" is worse than no feature, because it teaches people to trust
it.

## What `/cd` has to survive

The current test set (`cmd-session.mjs:187`) resolves a bare name under
`~/Projects`, treats anything matching `^[A-Za-z]:|^/` as absolute, and accepts
whatever `existsSync` says. On POSIX the drive-letter branch is dead weight; on
Windows a path like `\\server\share` (UNC) is neither. The rule that replaces it:

1. `reset` → unbind.
2. An existing absolute path (Windows drive, UNC, POSIX) → use as-is.
3. A bare name → `~/Projects/<name>`, then `config.cwd/<name>`.
4. Anything else → one line saying what was tried, not a silent fallback.

Case 4 is the honest one: today a typo produces "path not found: <path>" with
the *resolved* path, which is fine, but a path that exists and is a file (not a
directory) is accepted and then fails inside the turn.

## Reports: what leaves the machine

A report is a file, because a screenshot of a stack trace is not data. Contents:

- bridge version, host version, platform, profile name, model, chain position;
- the failing turn's last N log lines, with `token`, `apiKey`, `Bearer`,
  any `*_API_KEY` value and the home directory replaced by `<home>`;
- the names of the tools the turn called — never their arguments, which is where
  a person's file contents and secrets live.

Redaction runs before the file is written, and `scan-secrets.mjs` runs over the
produced fixture in a test, so a pattern that slips through fails the suite
rather than a stranger's inbox.

## Alternatives considered

- **Ask the model to stay in its directory.** Rejected: a prompt is not a
  boundary, and the complaint is precisely that a model wandered.
- **One profile per topic, always.** Rejected: a profile copy per topic is a
  directory per topic, and most topics need no override at all. Derived-only
  keeps the default case free.
- **Ship the chain presets in the repo.** Rejected: vendor names and keys are
  personal data; the repo's own portability scan forbids them outside the
  CHANGELOG.
