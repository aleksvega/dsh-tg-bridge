# dsh-tg-bridge

A Telegram bridge for [DeepSeek Harness](https://deepseek.com): drive the agent from a
bot with text, voice and photos, without opening the desktop app.

Each forum topic is a separate project with its own session and its own working
directory. Replies arrive with progress, a "Stop" button and copyable code
blocks.

## Features

- **Text**: a regular task goes to the agent, the answer comes back in the same topic.
- **Voice**: local faster-whisper, the transcript is shown before the answer.
- **Photos**: sent to a vision-capable model; text and UI are recognized.
- **Project per topic**: `/cd my-app`, and all turns run from that directory.
- **Goal and checklist per topic**: `/goal`, `/task`; both survive restarts and are prepended to every turn.
- **Live progress**: "⏳ Working..." with steps, a timer and the cache hit rate at the end.
- **No lost messages**: a journal with acknowledgement and replay.
- **Fail-fast**: when the quota runs out it switches to a free model right away.
- **`dsh-tg check`**: diagnostics in one command, no changes to the system.
- **Languages**: menus and service messages in `en`, `ru`, `zh`; `/lang` switches the topic language, a new user gets theirs from the Telegram `language_code` (anything outside ru/zh → `en`).
- **"Stop"/"Retry" buttons, tool confirmations**: right in the message, no commands to type.

## Requirements

- Node.js ≥ 20
- DeepSeek Harness `0.2.1-rc.2` or newer in the `0.2.x` line (`>=0.2.1-rc.2 <0.3.0`)
- DeepSeek Harness installed (`~/.dsh/profiles/headless`)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

The supported harness range is declared in `engines.dsh`; that field decides
compatibility on its own (DSH ignores `peerDependencies` when it is present).
The range includes an explicit prerelease branch, because a plain `<0.3.0`
silently excludes `0.2.2-*` builds. A future `0.3.0` needs an explicit bump:
the bridge relies on the `0.2.x` CLI flags and profile layout.

## Ecosystem

The Chinese DSH community maintains the largest plugin catalogs and the
in-app markets that read them; this bridge follows their packaging rules so it
can be listed next to them:

- [awesome-dsh-plugin](https://awesome-dsh-plugin.com) — bilingual (English /
  中文) plugin list and the `dsh-plugin-catalog` npm package
- [dsh-market](https://github.com/dsh-market/dsh-market) — the Chinese-built
  in-app market with one-click install and themes
- [dsh-find-plugin](https://github.com/awesome-dsh-plugin/dsh-find-plugin) —
  finds a plugin from chat instead of browsing a catalog

## Languages

- Menus (`/` in chat): three sets, `ru` by default, plus `en` and `zh`.
- Topic language: `/lang en|ru|zh`; stored in `state.json` and survives a restart.
- A new user gets the language from the Telegram `language_code`; anything that is not `ru`/`zh` → `en`.
- Translated so far: menus, the start message, turn status, errors, `/cd`, `/new`, `/stop`, `/lang`,
  the reply to an unknown command. Long reports (`/status`, `/sessions`, `/models` and similar)
  are still in Russian, that is the next pass.

## Installation

One command: your bot token and your numeric id. Nothing to edit by hand.

**Any platform with Node.js ≥ 20**

```bash
npx dsh-tg-bridge@latest init --token 123456789:AA... --user 123456789
npx dsh-tg-bridge@latest setup
```

`init` writes the token, your id and the working directory; `setup` registers
autostart and starts the bridge.

**As a DSH plugin** (the package carries a `dsh.bundle`; the catalog entry is
pending review):

```bash
dsh plugin --profile desktop add dsh-tg-bridge
```

The plugin starts one bridge when DSH boots and stops it on shutdown; if a
bridge is already running (for example from the scheduled task), it leaves it
alone. Run `npx dsh-tg-bridge@latest init ...` first so a config exists.

What `init` does:

| What | Where |
|---|---|
| bot token | `~/.dsh/.credentials.yaml` → `refs.DSH_TELEGRAM_BOT_TOKEN`; other keys are left alone |
| your id and working directory | `~/.dsh/tg-bridge/config.json`; an existing file is not overwritten |
| `headless` profile | checked, with a hint on how to create it if missing |

`init` flags: `--cwd <path>` (default `~/Projects`), `--voice` (enable
voice transcription), `--dry-run` (show what would be written, change nothing).

Optional provider settings live in `config.json`:

| Key | Meaning |
|---|---|
| `providerKeys` | extra env var names to pass to a turn, read from `~/.dsh/.credentials.yaml`; default `[]` |
| `pricesUrl` | public model page for `/prices`; default `""` uses models.dev only |
| `vision.patch` | overlay for photo turns; default `""` (photos are text-only until set) |
| `fallbackModels` | free-model fallbacks; default `[]` |

Get your id from [@userinfobot](https://t.me/userinfobot), the token from
[@BotFather](https://t.me/BotFather).

### Bot settings in Telegram

Three things without which the bot will stay silent in a group or work only halfway:

1. **Privacy mode → Disable** (`/setprivacy` in BotFather). Otherwise the bot sees
   only commands, not regular text in a topic.
2. **Topics enabled** in the group settings (Edit → Topics). Without them all work
   goes to a single chat and per-topic sessions are not created.
3. **Pin Messages** permission for the bot. Only needed to pin the first
   message of a topic; without it the bridge keeps working but will not pin.

You do not need to set up the command menu by hand: `init` and `setup` install it
in Russian, English and Chinese at once. The menu is not refreshed by a plain
bridge restart, so after adding commands run `dsh-tg menu`. The full settings
table, permissions, checks and common errors are in
[docs/TELEGRAM-SETUP.md](docs/TELEGRAM-SETUP.md).

**Autostart** is installed by the setup: `launchd` on macOS, `systemd --user` on
Linux. On Windows `setup` registers the `DSH-TG-Bridge` task, which runs the
guarded supervisor (the same launcher on logon and every five minutes) so a
crashed bridge comes back without a second poller.

**Manual install** (if you want full control):

```bash
npm install -g dsh-tg-bridge
dsh-tg init --token 123456789:AA... --user 123456789
dsh-tg check     # report only, changes nothing
dsh-tg setup     # stop the old bridge and start the new one
```

If the bridge is already installed, `setup` restarts it on the new code and reinstalls
the command menu.

## Troubleshooting

Error replies end with a code, which tells you what to fix:

| Code | Meaning |
|---|---|
| `INSUFFICIENT_QUOTA` | provider balance is empty: top up or stay on free models (`/prices`, `/models`) |
| `TG_CONFLICT` | a second process is polling the same bot: `/doctor`, then `/restart` |
| `MISSING_CREDENTIAL` | no provider key in the profile: add it in the DSH app |
| `NO_DSH_CLI` | DeepSeek Harness CLI not found: check the app installation |
| `NETWORK` | no network to the provider: retry, check VPN/DNS |
| `SANDBOX_DENY` | DSH denied access to a file or directory: check the project path and permissions |
| `UNKNOWN_MODEL` | the model from the config is unavailable: `/models` lists the working ones |
| `EMPTY_RESPONSE` | the model returned nothing: retry or switch model (`/model`) |
| `TURN_FAILED` | cause not recognized: `/doctor` and `/logs errors` |

## Checks

Send the bot:

| Command | Expected |
|---|---|
| `/doctor` | report: pid, Telegram, disk, directory, session |
| `/help` | commands grouped by category |
| `/cd my-app` | topic bound to the project |
| `/prices` | model prices and the cost of the current one |

## Commands

```
Work:         /cd · /new · /stop · /send · /seed
Goals:        /goal · /task
Sessions:     /status · /sessions · /resume
Models:       /models · /model · /prices
Profiles:     /profile · /profile <name> · /profile new <name> from <template>
Extensions:   /skills · /plugins · /plugin · /soul
Diagnostics:  /doctor · /logs [errors|N|text]
Service:      /app · /restart · /help
Display:      /lang · /reasoning on|off
```

## How it works

```
Telegram → bridge.mjs → dsh --profile headless --json → reply
             │
             ├─ pending/ journal + ack  (messages are not lost)
             ├─ per-topic queue         (turns in topics run in parallel)
             ├─ progress + buttons      (you can see the work is going)
             └─ fail-fast on quota      (free models as a fallback)
```

The bridge is a single process with long polling. Each turn spawns a separate
CLI process that exits after the answer, so "no DSH process" between
turns is normal, not a failure.

### Steering during a turn

If you write in a topic while a turn is still running, the message does not queue
behind it: the bridge drops the task into `~/.dsh/tg-bridge/steer/`, the `dsh-steer-inbox`
plugin hands it to the live agent on its next step, and the agent immediately replies with a short
line in the chat: what it is doing now and where it put the addition. If the agent stays silent
for 90 seconds, the bridge writes one neutral line itself so there is no silence.

Attachments work the same way. A voice note is transcribed first and its transcript is echoed in
the chat, then the text is steered into the running turn; a photo or a file is downloaded to a
local path and that path is steered, exactly as an idle turn would hand it over.

What each kind of attachment becomes inside a running turn:

| Sent | Inside the turn |
|---|---|
| voice note, audio file, audio sent as a document | transcript, echoed as `🎤 …` before the steer |
| small text file (`.md`, `.json`, `.csv`, `.py`, `.log`, … up to 60 KB) | the content itself between `<file>` markers — no tool call needed |
| PDF, archive, binary, anything bigger | its local path under `~/.dsh/tg-bridge/inbox/` |
| video, video note, animation | its path; the agent can pull frames or sound out with ffmpeg |
| photo | its path plus one honest line: a running turn cannot apply the vision overlay, so the model says it cannot see the image instead of ignoring it silently |

A caption does not turn the attachment into a text-only message: it is folded into the same
hand-over, so "why did this fail" plus a `.log` file arrives as one steer.

This needs the plugin from this repository:

```bash
dsh plugin --profile headless add link:<path-to-repository>/plugin/steer-inbox
```

and a line in `~/.dsh/profiles/headless/cordis.patch.yml`:

```yaml
- insert:
    - id: steer-inbox
      name: 'dsh-steer-inbox'
```

The bridge checks the profile itself: if the line is missing, it does not write the task
(it would just expire) and behaves as before, queueing the message.

### Live thoughts

The agent can leave a short decision trail inside the progress message instead of sending
extra chat messages:

```bash
node ~/.dsh/tg-bridge/say.mjs --thought "checking why the watchdog fired twice"
```

The note is appended to `~/.dsh/tg-bridge/thoughts/<chat>_<thread>.jsonl`; the progress
message shows the last two as `💭` lines. The command needs no ids: it falls back to the
newest turn's thought file, because tool shells do not inherit the bridge environment.
`--thought` never sends a Telegram message on its own.

`/reasoning` is the switch for the whole mechanism. It is on by default: every turn carries a
short instruction to leave one line at each decision point (task clear, cause found, risky
change, result checked). `/reasoning off` drops the instruction and the `💭` lines for that
topic — useful when the step list is all you want. The setting lives in `state.json` per topic,
so a chatty research topic and a terse deploy topic can differ.

### Profiles per topic

The desktop app lets you build several profiles for different kinds of work, each with its own
plugin set and model. The same switch works from a topic:

```
/profile                    current profile, available ones, hints
/profile research           run this topic's turns on another profile
/profile new research from web
                            create a profile from a shipped template and bind it
/profile default            back to the install default
```

A new profile is written by `dsh <name> --from-default-profile <template> --dump-config`, so
nothing boots and no plugin is loaded at creation time; dependencies are installed by the
profile's first turn. The binding is per topic: `/model` then edits that profile's model, and
`/plugins` manages that profile's rows.

### Goals and tasks

A topic carries its own goal and checklist, so the aim survives `/new`, a
restart and a different session:

```
/goal ship the release      set or replace the goal
/goal                       show the goal and the checklist
/task write the migration   add a task
/task done 2                tick it off
/task rm 2                  remove it
/goal done                  close the goal (all tasks done)
/goal clear                 delete the goal and its tasks
```

The bridge prepends the goal and the list to every turn, with the exact command
that updates it (`goal.mjs`). The agent ticks tasks as it finishes them, and the
next turn sees the new state. The bridge is the only writer of `state.json`: the
agent drops a job file into `goal-jobs/` and the bridge applies it, so there is
no lock race and no lost update.

## Security

- `config.json`, `state.json`, `pending/`, logs are in `.gitignore` and never
  end up in the repository.
- The token is stored in the DSH credentials store, not in code or config.
- The bridge only replies to ids in `allowedUserIds`.

## Documentation

- [docs/TELEGRAM-SETUP.md](docs/TELEGRAM-SETUP.md): BotFather settings, group and bot permissions
- [docs/ROADMAP.md](docs/ROADMAP.md): what comes next
- [docs/UX-ANALYSIS.md](docs/UX-ANALYSIS.md): interactive UX review
- [docs/COST.md](docs/COST.md): what one turn costs and how to reduce it
- [docs/CHANGELOG.md](docs/CHANGELOG.md): change history
- [docs/RELEASE-CRITERIA.md](docs/RELEASE-CRITERIA.md): release readiness criteria

## License

MIT, see [LICENSE](LICENSE).
