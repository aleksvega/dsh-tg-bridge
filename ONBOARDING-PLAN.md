# Onboarding: how a newcomer gets from "I found this repo" to a working bot

Three entry points, one goal: a person who has never used a bot, never made a
Telegram token and does not know what a profile is ends up with a bot that
answers in their topic, without reading the source.

## Entry 1 — the marketplace (desktop, web, or the `dsh` CLI)

Status: the listing exists (awesome-dsh-plugin PR), the steps after the button
are what this document designs.

1. **Find it.** Marketplace search finds `dsh-tg-bridge` by name, by
   "telegram", and by "bot". The listing text is the first three lines of the
   README's "what you get", not the whole README.
2. **Prerequisite, said out loud before anything is installed.** Node 20+ and a
   DSH profile. If Node is missing, the installer says which version to get and
   stops; it does not try to install Node itself.
3. **Install.** The marketplace runs the DSH plugin install, which copies the
   package into the profile's `node_modules` and adds the plugin row. The
   bridge is not started by installing it: a bridge with no token cannot answer
   a single message.
4. **Onboarding, in the chat that asked for it.** DSH opens the plugin's setup
   page, which is a checklist, not a form:
   1. *Make a bot.* "Open @BotFather in Telegram → /newbot → pick a name and a
      username ending in `bot` → copy the line that starts with `123456:`".
      A screenshot and the exact tap sequence, because this is where people
      stop.
   2. *Paste it here.* The token goes into `~/.dsh/.credentials.yaml` as
      `DSH_TELEGRAM_BOT_TOKEN`; never into a tracked file. The page says where
      the file is and that it stays local.
   3. *Talk to your bot.* "Press Start on your bot in Telegram, then send
      `hi`." The page waits for the first incoming message and shows it, so
      step 2 is proven before step 4.
   4. *Your user id.* The id from that message; the bridge accepts only this
      user. It is filled in automatically — the person does not look it up.
   5. *Where it works.* Private chat (default) or a group; for a group, the
      bot must be an admin and topics must be enabled.
   6. *Done.* The page says what now works: every topic is a project,
      `/help` lists the commands, `/cd` binds a topic to a folder.
5. **The first message.** The bridge answers in the language the person wrote
   in; `/lang` pins it.

## Entry 2 — the link, and an agent that walks them through it

A person who opens the repo by link has an agent next to them, so the repo
ships a skill instead of asking them to read `README.md` line by line.

`skills/dsh-tg-bridge-onboarding/SKILL.md` — installed by pointing an agent at
the repo (`jev-skill-router --install aleksvega/dsh-tg-bridge --scan`) or by
copying the folder. Its contract:

- Ask **three** questions, never a form: what do you want the bot for (a
  project folder, a chat with yourself, a team group), do you have a bot token
  already, which OS.
- Then run `dsh-tg check` first: it reports Node, DSH, token, profile and
  network, and the skill fixes only what is red.
- Sending `/onboarding` in Telegram replays the same six steps inside the
  chat, for the person who does not want an agent in the loop.

## Entry 3 — the repo itself

`QUICKSTART.md` is the same six steps without the marketplace, for someone who
clones: `npm i -g dsh-tg-bridge`, `dsh-tg setup`, talk to the bot. It ends with
the three things that actually go wrong (token in the wrong file, bot not an
admin in a group, Node older than 20) and what the message looks like.

## What is missing today

- `setup.mjs` exists and checks the token, but it prints a log, not a checklist
  with a "waiting for your first message" step.
- No `/onboarding` command; the chat has `/help` and `/doctor`.
- No skill tied to this repo.
- The marketplace listing text is written but not verified against a fresh
  profile.

## Order of work

1. `/onboarding` (chat-side, no new install): the six steps as a card with one
   button per step, and the first-message wait. Cheapest, works for everyone.
2. `QUICKSTART.md` from the same text, so the two cannot drift.
3. The skill, which wraps `dsh-tg check` and the three questions.
4. The setup page's checklist, which reuses the card's text.