# Telegram settings for the bridge

Short version: the bot must see all messages in the group and have the right to
pin. Everything else, command menus, topics, replies, the bridge does itself.

If the bot stays silent in a group, nine times out of ten privacy mode is on:
the bot sees only commands and replies to its own messages, not regular text in a topic.

## 1. BotFather

| What | How | Why |
|---|---|---|
| Privacy mode | `/setprivacy` → **Disable** | Without it the bot does not receive message text in groups, only commands. The main setting. |
| Groups | `/setjoingroups` → **Enable** | Enabled by default; if disabled, the bot cannot be added to a group. |
| Commands | nothing | The bridge calls `setMyCommands` on start itself: the Russian list by default plus `en` and `zh` via `language_code`. Manual configuration will be overwritten. |
| Token | `/token` | Passed to `init --token`; stored in `~/.dsh/.credentials.yaml` → `refs.DSH_TELEGRAM_BOT_TOKEN`, not in `config.json` and not in the repository. |

If privacy was already enabled and the bot is already in the group, remove the bot from the group and
add it again. That is the reliable way to apply the mode; without reconnecting you can spend a long time
chasing "the bot does not see messages".

## 2. Group

1. Enable **Topics** (in the group settings: Edit → Topics). Without topics all work
   goes to a single chat: the bridge survives that, but per-topic sessions and
   pinned cards will not work.
2. Add the bot to the group.
3. Give the bot permissions:
   - **Send Messages**: required, otherwise it will not reply;
   - **Pin Messages**: needed to pin the first message of a topic
     (`pinTopicSeed`, `true` by default). Without the permission the bridge just writes
     `pin failed` to the log and keeps working;
   - **Read Messages**: if the bot is an admin it sees messages even without privacy mode.
4. **Manage Topics** is not needed: the bridge does not create topics, it replies in
   existing ones. **Delete Messages** is not needed either.

A private chat works with no group settings: `/start` is enough, but
`allowedUserIds` is still checked.

## 3. Bridge config

`~/.dsh/tg-bridge/config.json`:

| Key | Value | What it does |
|---|---|---|
| `allowedUserIds` | `[123456789]` | Allow list. An empty list means the bridge answers nobody. You can list a person id or a chat id. |
| `cwd` | path | Working directory for sessions. |
| `generalLobby` | `true` | A message in General is moved to the last active topic instead of opening a new session. |
| `pinTopicSeed` | `true` | Pin the first message of a new topic. Needs the Pin Messages permission. |
| `topicLog` | `true` | Service log for the topic. |

The token and id can be written with one command:

```powershell
npx dsh-tg-bridge@latest init --token 123456789:AA... --user 123456789
```

## 4. Single instance

Two processes with the same token get `409 Conflict` from Telegram, and both lose
messages. Stop autostart before starting the bridge by hand.

Windows: the watchdog first, otherwise it will bring the bridge up in a minute:

```powershell
Disable-ScheduledTask -TaskName 'DSH-Bridge-Kick'
Stop-ScheduledTask -TaskName 'DSH-TG-Bridge'
Stop-Process -Id (Get-Content "$env:USERPROFILE\.dsh\tg-bridge\bridge.pid") -Force
```

To restore autostart: `Enable-ScheduledTask -TaskName 'DSH-Bridge-Kick'` and
`Start-ScheduledTask -TaskName 'DSH-TG-Bridge'`, or simply `node cli.mjs setup`.

macOS:

```bash
launchctl bootout gui/$(id -u)/com.dsh.tg-bridge
```

Linux:

```bash
systemctl --user stop dsh-tg-bridge
```

## 5. Check in a minute

1. `/status`: a reply means the token is valid and long polling works.
2. Send a message in a topic: progress and then an answer should arrive.
3. `/restart confirm`: the reply "Bridge restarted" should arrive in the same topic.
4. Silence: `/logs`, then `node cli.mjs check`. In the log look for `401` (bad token),
   `409` (second instance), `ignored message from` (id not in `allowedUserIds`).

## 6. What you do not need to set up

- **Webhook and public URL**: the bridge uses long polling, no inbound port is
  needed.
- **Inline mode, payments, games, description**: not used.
- **Channels**: the bridge targets private chats and groups/supergroups.
