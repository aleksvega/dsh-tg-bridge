# Getting help without leaking your machine

The bot runs on your computer, with your keys, in your home directory. That makes
"it broke, here is a screenshot" almost useless: the cause is usually in a line
of `bridge.log` that the screenshot does not contain. `/report` exists to close
that gap — it assembles the facts a maintainer needs into one small document and
removes the facts nobody needs before it leaves.

## The one command

```
/report
```

In a direct chat with the bot, the reply is a `.md` document. In a group topic,
the reply is the path on disk and nothing else: a log tail is not group material,
and a group is not the place to discover that a token was in it.

Add a sentence if you already know what you did:

```
/report I ran /cd then every message went silent
```

That sentence lands at the top of the bundle, because "what I did just before"
is the one fact the bridge cannot observe.

## What the bundle contains

| Section | Why it is there |
| --- | --- |
| bridge, node, system | A version pair answers most "does it even support that" questions |
| profile, preset | The permission preset is what a denied write is measured against |
| model, chain | Which route answered, and what it would have fallen back to |
| cwd | The directory the turn ran in — a wrong `cwd` explains most "it edited the wrong project" reports |
| tools | The tool names the turn called, in order, no arguments |
| failure | The last failure of that topic, with its short code |
| log tail | The last 120 lines of `bridge.log` |

Everything is capped: the log tail is 120 lines and the document stops at 60 000
characters. A report is meant to be read, not attached to a ticket system.

## What never leaves

Before the file is written, every one of these is replaced in place — the shape
stays, the identity does not:

- API keys and tokens (`sk-…`, `ghp_…`, `AKIA…`, `AIza…`), bot tokens (`<digits>:<secret>`), `Bearer …` headers, private key blocks;
- the home directory, in both slash styles, and any `X:\Users\<name>` or `/home/<name>/` path — they become `<home>`;
- chat ids, thread ids and user ids — labelled ones by pattern, and this bridge's own ids exactly;
- 16-hex machine ids and email addresses.

`test/report.test.mjs` runs the shipped `scan-secrets.mjs` rules over a fixture
built to look like a real log tail, and fails if a single rule matches. The
scanner is the same one the repo uses on itself before every release, so "the
report is clean" is not a promise, it is a test.

## What to send anyway, by hand

Some things a bundle cannot carry, and a maintainer will ask for them:

- the message you sent and the reply you got (a screenshot is fine here — it is
  the conversation, not the machine);
- the moment it happened, if the report is not from right after;
- whether `/restart confirm` was run since the problem started. A restarted
  bridge and an old bridge answer differently, and the version line alone does
  not say which one is answering.

## What never to send

- `config.json` and `.credentials.yaml`. They hold the bot token and provider
  keys in plain text, and a pasted token has to be revoked, not deleted.
- your whole `bridge.log`. `/report` already took the useful tail and cleaned it.
- the contents of `state.json`. It is mostly ids.

If a token did leak into a chat, revoke it first and diagnose second: Telegram's
`/revoke` for a bot token, the provider's dashboard for a model key.

## "The bot went silent" — the one-line answer

Silence is not one failure, it is three, and they are told apart in one step:

1. `/status` answers → the bridge is alive; the turn failed or is still running.
   `/logs errors` shows the cause.
2. `/status` does not answer, but the machine is on → the process is gone.
   Start it again (`dsh-tg init` or the shortcut) and read the last lines of
   `bridge.log`; a fatal error is written there before the exit.
3. Nothing answers and the process is alive → the token is wrong or another
   process is polling. `409 Conflict` in the log means two copies of the bot are
   running; only one may poll.

Then `/report`. The bundle carries the log tail, so the answer is usually in it
already.
