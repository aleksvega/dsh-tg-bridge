---
name: dsh-tg-bridge-onboarding
description: Walk a complete beginner from nothing to a working DeepSeek Harness Telegram bot with dsh-tg-bridge — no Telegram account, no bot, no token. Use when someone says "set up the Telegram bot", "install dsh-tg-bridge", "how do I get a bot token", "плохо, подключи телеграм", "не понимаю, как подключить бота", or when a fresh install has to be verified end to end.
whenToUse: Before the bridge exists on their machine, or when a bridge is installed but nobody has confirmed it answers.
---

# Onboarding someone onto dsh-tg-bridge

The person may have never used Telegram, never made a bot, and never opened a
terminal. Your job is one confirmed answer in their chat, not a completed
checklist. Every step below ends in something you can see.

Repo: https://github.com/aleksvega/dsh-tg-bridge — the long-form guide is
`QUICKSTART.md` there. Read it if anything below is ambiguous; it is written for
the person, not for you.

## 0. Ask three questions, then stop asking

1. **Telegram account** — do they have one? If not: install the app
   (telegram.org or the app store), register with a phone number, wait for the
   SMS code. Nothing else can start before this.
2. **What the bot is for** — their own work, one project folder, or a team group.
   This decides `--cwd` and whether their id must be added to a group.
3. **Which machine stays on** — the bot answers only while that computer is
   awake. A laptop that sleeps is the usual reason "it stopped working".

## 1. Bot token (they must do this; it cannot be automated)

1. In Telegram search **@BotFather**, press **Start**, send `/newbot`.
2. Name: anything. Username: must end in `bot`.
3. BotFather replies with `123456789:AAH...` — that is the token.

If they cannot find BotFather, send them `https://t.me/BotFather`. If Telegram
says the username is taken, add a word.

**Never paste the token into a file in a repository, a commit, or a chat message
you will quote back.** The next step writes it where it belongs.

## 2. Their numeric id

Send `/start` to **@userinfobot** (`https://t.me/userinfobot`), copy the `Id:`
number. It is not the phone number and not the `@username`.

## 3. Check the machine first

```bash
node --version        # must be 20 or newer
npx dsh-tg@latest check
```

`check` lists what is missing. Missing Node: install from nodejs.org, restart the
terminal. Empty output with a non-zero exit usually means `npx` is not on PATH.

## 4. Install with one command

```bash
npx dsh-tg@latest init --token <token> --user <id> [--cwd <project dir>] [--dry-run]
npx dsh-tg@latest setup
npx dsh-tg@latest menu
```

- `init` writes the token to `~/.dsh/.credentials.yaml` and their id to
  `~/.dsh/tg-bridge/config.json`. It never overwrites an existing `config.json`.
- `setup` copies the bridge to `~/.dsh/tg-bridge`, registers the background
  start, and starts it once.
- `menu` pushes the command list to Telegram.

The package name is `dsh-tg-bridge`; the CLI it installs is `dsh-tg`. Version
1.13.0 shipped without `format.mjs` and could not start — if you see
`ERR_MODULE_NOT_FOUND`, run `npm i -g dsh-tg-bridge@latest`.

## 5. Verify in the chat, not in the logs

Ask them to send `hi` to the bot. You are done when they report an answer, not
when `check` prints success. If nothing arrives, in this order:

| Symptom | Cause |
|---|---|
| Silence, no error | id in `config.json` is not theirs, or the bridge is not running |
| `401 Unauthorized` | token wrong or revoked — redo step 1 |
| Silent in a group only | BotFather `/setprivacy` → Disable, then re-add the bot |
| `TG_CONFLICT` | two bridges polling the same bot — `/doctor`, kill the duplicate |
| `MISSING_CREDENTIAL` | they have not signed into a provider in the DSH app yet |
| `NO_DSH_CLI` | DeepSeek Harness is not installed on that machine |

In the chat, `/doctor` prints the same diagnosis they can read themselves.

## 6. Five things to teach, then stop

Type, don't explain:

- `/cd /path/to/project` — all turns then run there.
- `/model` — pick a model; `/permissions` — how much it may do.
- `/goal <what done looks like>` and `/task <step>`, then `/tasks` — a plan they
  can tap off as it moves.
- `/stop` — kills a long answer; `/restart confirm` — reloads code after an update.
- `/help` — every command.

`/lang ru|en|zh` pins the reply language; without it it matches the language they
write in.

## Failure modes worth knowing

- **Do not restart the bridge for them.** It polls Telegram; two pollers make it
  go silent. `/restart confirm` is typed by the person.
- **Do not run `init` twice with a different id** and expect the old config to
  change: an existing `config.json` is left alone on purpose. Delete it first if
  it is wrong.
- **Do not put the token in a `config.json` you copy around** — `init` puts it in
  the credentials store; a token in a repo is what `scan-secrets.mjs` refuses on
  push.
- **Voice needs `--voice` plus python and faster-whisper**; without it, a voice
  message gets a text answer saying it was not transcribed.