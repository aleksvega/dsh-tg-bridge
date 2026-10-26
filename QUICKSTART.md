# Quickstart: from zero to a bot that answers

Written for someone who has never made a Telegram bot and does not know what a
profile is. Twelve minutes, most of it waiting for the bot to say hello.

If an AI agent is helping you, skip to [For agents](#for-agents): it can do
steps 2–5 for you and only needs your answers to three questions.

---

## 0. What you need before you start

- **Node.js 20 or newer.** Check with `node --version`. If the number is lower or
  the command is missing, install Node from [nodejs.org](https://nodejs.org) first
  — nothing below works without it.
- **A computer that stays on.** The bot runs on your machine, not in a cloud.
  Laptop is fine; it answers only while awake.
- **DeepSeek Harness**, the app this bridge connects to Telegram.
- **Ten minutes and your phone.**

## 1. Make a bot in Telegram

1. Open Telegram and search for **@BotFather** (the one with the blue checkmark).
2. Press **Start**, then send `/newbot`.
3. It asks for a **name** — anything people will see: `My work bot`.
4. It asks for a **username**, which must end in `bot`:
   `my_work_2026_bot`. If it says the name is taken, add a word.
5. BotFather answers with a line like
   `Use this token to access the HTTP API: 123456789:AAH...` — that is your
   **token**. Treat it like a password: anyone with it controls your bot.

Optional but recommended in the same chat:

- `/setprivacy` → **Disable** — only needed for groups; without it the bot sees
  commands there but not ordinary text.
- `/setjoingroups` → **Enable** — if you want to use it in a group at all.

## 2. Tell the bridge about the token

```bash
npx dsh-tg-bridge@latest init --token <the token> --user <your id>
```

- **`<the token>`** — the line from step 1, in quotes if your shell needs it.
- **`<your id>`** — the number Telegram gives you. Don't know it? Send `/start`
  to **@userinfobot** and copy the `Id:` line. The bridge answers only this
  account; anyone else is ignored.

`init` writes the token to `~/.dsh/.credentials.yaml` (never to the project
folder) and your id to `~/.dsh/tg-bridge/config.json`. Add `--cwd D:\work` if your
projects live somewhere other than `~/Projects`, and `--dry-run` to see what it
would write without writing.

## 3. Start the bridge

```bash
npx dsh-tg-bridge@latest setup
```

This registers the bridge so it starts with your session and runs it once. It
ends with `ok new bridge pid <number>` — that number is the running bridge. A
failure here is almost always one of the three things in [If it does not
work](#if-it-does-not-work).

## 4. Say hello

1. In Telegram, open your bot (BotFather gives you a `t.me/...` link) and press
   **Start**.
2. Send `hi`.

You should see two messages: a short "got it" and then the answer. If you see a
progress line with a spinner instead, it is working — the answer follows.

## 5. Make it yours

Everything below is typed in the chat, not in a terminal.

| What you want | Type |
|---|---|
| Work on a project folder | `/cd /path/to/project` |
| A separate space per project | turn on **Topics** in the group, one topic per project, `/cd` in each |
| Cheaper or stronger model | `/model` then pick, or `/model <id>` |
| More freedom for commands | `/permissions` |
| See what it is doing | it posts a live progress message; `/thoughts` toggles the 💭 notes |
| A plan you can tick off | `/goal <what done looks like>`, then `/task <step>`, then bare `/task` to tap items |
| Stop a long answer | `/stop` |
| Tell me about new versions, or stop | /update on / /update off — neither one installs anything |
| Install an update, then load it | /update confirm, then /restart confirm |
| Everything it can do | `/help` |

`/lang` pins the reply language; without it the bridge answers in the language your
write in (Russian, Chinese, otherwise English).

---

## If it does not work

| What you see | What it means |
|---|---|
| Nothing at all after `hi` | The id in `config.json` is not yours, or the bridge is not running: `npx dsh-tg-bridge@latest setup` again and read its output. |
| `401 Unauthorized` | The token is wrong or was revoked by BotFather. Run `init` again with a fresh token. |
| Works in private chat, silent in a group | Privacy mode is on: `/setprivacy` → Disable, then remove and re-add the bot to the group. |
| `Error [ERR_MODULE_NOT_FOUND]` on start | The running copy is older than the files it imports. A global install never updates itself: `npm i -g dsh-tg-bridge@latest`, then `/restart confirm` in the chat. With `npx` this cannot happen — `npx dsh-tg-bridge@latest` fetches the newest release on every launch. |
| Bot answers in the wrong language | `/lang ru` / `/lang en` / `/lang zh` — one command pins it for the topic. |
| Two answers to one message | Another copy of the bridge is running: `/status` shows the pid, kill the duplicate. |

Still stuck: `/doctor` in the chat, or `npx dsh-tg-bridge@latest check` in a
terminal — both print what is missing and how to fix it.

---

## For agents

An agent helping a person needs three answers, then can do the rest:

1. **What is the bot for** — a project folder, a chat with themselves, or a team
   group? This decides `--cwd` and whether `--user` must be added to a group.
2. **Do they have a bot token already** — from [@BotFather](https://t.me/BotFather)?
   If not, walk them through step 1 of this file; it cannot be automated.
3. **Which OS** — Windows, macOS or Linux; it changes where the background start
   lives, not what the bridge does.

Then:

```bash
npx dsh-tg-bridge@latest check        # what is missing right now
npx dsh-tg-bridge@latest init --token <token> --user <id> [--cwd <path>] [--dry-run]
npx dsh-tg-bridge@latest setup       # register autostart and start
npx dsh-tg-bridge@latest menu        # push the command menu to Telegram
```

Verify with a real message, not with logs: ask the person to send `hi` and wait
for the answer before declaring success. `check` reporting success only means the
files are in place.

Never echo the token into a transcript, a commit, or a file inside a repository:
`init` puts it in `~/.dsh/.credentials.yaml` and nothing else should hold it.
If you keep notes, keep them outside the repo — `scan-secrets.mjs` refuses tokens,
personal ids and home paths on every commit.