# dsh-tg-bridge

A Telegram bridge for [DeepSeek Harness](https://deepseek.com): drive the agent from a
bot with text, voice and photos, without opening the desktop app.

Each forum topic is a separate project with its own session and its own working
directory. Replies arrive with progress, a "Stop" button and copyable code
blocks.

Never made a bot? [QUICKSTART.md](QUICKSTART.md) takes you from "no account" to
a bot that answers, one step at a time.

## Features

- **Text**: a regular task goes to the agent, the answer comes back in the same topic.
- **Voice**: local faster-whisper, the transcript is shown before the answer.
- **Photos**: the turn's own model reads them through `read_image`, text and UI
  included; no second model is needed (a vision overlay stays opt-in).
- **Project per topic**: `/cd my-app`, and all turns run from that directory.
- **Goal and checklist per topic**: `/goal`, `/tasks`; both survive restarts and are prepended to every turn.
- **Live progress**: one edited message per turn — steps, a timer and the cache hit rate, plus
  the model's reasoning in a collapsed block you can tap open. A long turn adds a second
  collapsed block with every tool call, so the whole run stays in the chat as one message.
- **No lost messages**: a journal with acknowledgement and replay.
- **Settings per topic**: `/crew use reviewer` gives one topic its own model,
  effort, permissions, agent preset and language while the others keep the profile;
  `/crew off` returns it. Four built-in sets ship read-only and can be copied.
- **Fail-fast**: when the quota runs out it switches to a free model right away.
- **`dsh-tg check`**: diagnostics in one command, no changes to the system.
- **Languages**: menus and service messages in `en`, `ru`, `zh`; `/lang` pins the topic language, and without it a new topic takes the language of the message itself (Cyrillic → `ru`, Han characters → `zh`), then the Telegram `language_code`, then `en`.
- **"Stop"/"Retry" buttons, tool confirmations**: right in the message, no commands to type.

## Requirements

- Node.js ≥ 24 (the version DeepSeek Harness ships; sessions are zstd-compressed)
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

- Menus (`/` in chat): three sets, `ru` by default, plus `en` and `zh`; a client whose locale matches neither gets the Russian set.
- Topic language: `/lang en|ru|zh`; stored in `state.json` and survives a restart.
- A new user gets the language from the Telegram `language_code`; anything that is not `ru`/`zh` → `en`.
- Translated so far: menus, the start message, turn status, errors, `/cd`, `/new`, `/stop`, `/lang`,
  the reply to an unknown command. Long reports (`/status`, `/sessions`, `/model` and similar)
  are still in Russian, that is the next pass.

## Installation

One command: your bot token and your numeric id. Nothing to edit by hand.

**Windows, macOS or Linux — Node.js 24 or newer.** `init` and the bridge run
anywhere; `setup` (stop, autostart, restart) is **Windows-only** today, so on
macOS and Linux use `sh install.sh`, which registers `launchd` or `systemd --user`.
`node setup.mjs --check` reports state on every platform.

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
| `vision.patch` | opt-in overlay profile for photo turns; default `""` — the turn's own model reads images |
| `vision.enabled` | set `true` to run photo turns on `vision.patch` instead of the topic profile |
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
[docs/TELEGRAM-SETUP.md](https://github.com/aleksvega/dsh-tg-bridge/blob/master/docs/TELEGRAM-SETUP.md).

**Autostart** has two routes. `sh install.sh` writes `launchd` on macOS and
`systemd --user` on Linux; `dsh-tg setup` registers the `DSH-TG-Bridge` task on
Windows, which runs the guarded supervisor (the same launcher on logon and every
five minutes) so a crashed bridge comes back without a second poller. On macOS
and Linux `setup` declines and names `install.sh`, because it stops the old
bridge with `taskkill` and registers autostart through `schtasks`.

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

Starting from nothing, or helping someone who is: [QUICKSTART.md](QUICKSTART.md)
has the same answers with the terminal output they will actually see.

Error replies end with a code, which tells you what to fix:

| Code | Meaning |
|---|---|
| `INSUFFICIENT_QUOTA` | provider balance is empty: top up or stay on free models (`/prices`, `/model`) |
| `TG_CONFLICT` | a second process is polling the same bot: `/doctor`, then `/restart` |
| `MISSING_CREDENTIAL` | no provider key in the profile: add it in the DSH app |
| `NO_DSH_CLI` | DeepSeek Harness CLI not found: check the app installation |
| `NETWORK` | no network to the provider: retry, check VPN/DNS |
| `SANDBOX_DENY` | DSH denied access to a file or directory: check the project path and permissions |
| `UNKNOWN_MODEL` | the model from the config is unavailable: `/model` lists the working ones |
| `EMPTY_RESPONSE` | the model returned nothing: retry or switch model (`/model`) |
| `TURN_TIME_CAP` | the turn hit its own time ceiling: the work is saved, press Continue |
| `TURN_FAILED` | cause not recognized: `/doctor` and `/logs errors` |

## Checks

Send the bot:

| Command | Expected |
|---|---|
| `/doctor` | report: pid, Telegram, disk, directory, session |
| `/version` | bridge version, the latest on npm, bridge directory |
| `/update` | says whether a newer release exists (`/update confirm` installs it) |
| `/thoughts [file\|all\|off]` | the last turn's reasoning as a message; `file`/`all` send the full log as a Markdown document, `off` hides the block |
| `/help` | commands grouped by category |
| `/cd my-app` | topic bound to the project |
| `/prices` | what the current model costs, and whose price that is: your provider's, the same model on another gateway, or "no public price" when nobody publishes one |

## Commands

```
Work:         /cd · /new · /stop · /send · /seed
Goals:        /goal (plan + checklist) · /goal reopen · /tasks (checklist only) · /tasks done|rm|edit <n>
Sessions:     /status · /sessions · /resume
Agents:       /agents · /agents <id> · /agents set model|depth|filter
Models:       /model · /model <id> · /prices
Tuning:       /effort · /permissions · /preset · /plan · /jobs · /remind
Profiles:     /profile · /profile <name> · /profile new <name> from <template>
Sets:         /crew · /crew use|off|new|copy|rm · /crew model <v>
Extensions:   /skills · /plugins · /plugins search <word> · /plugins disable|enable <id> · /soul
Updates:      /version · /update · /update confirm · /update on|off|check|auto · /subscribe on|off
Diagnostics:  /doctor · /logs [errors|N|text]
Service:      /app · /restart · /help
Settings:     /settings — the same switches as buttons, grouped in four tabs
Display:      /lang · /reasoning on|off · /thoughts
```

### Settings as a card

`/settings` draws the same switches that the commands set, in one message with
four tabs: what the bot says, who answers and how hard it works, new releases,
and the health checks. Each row shows what the setting is now and what a tap
would change it to. A tap runs the command a person would have typed
(`/reasoning off`, `/update on`), so the card cannot disagree with the command:
it is a view of them. After the change the card collapses into one plain line —
delete it and the chat is back to what it was.

Nothing on the card is only available on the card. `/settings` is for people who
would rather press a labelled button than remember which of `/effort`,
`/preset` and `/crew` changes what.

Every command answers `/help` in the chat, in the language you write in: a
message written in Cyrillic or Han characters switches the topic to Russian or
Chinese even when the phone's menu is set to another language, and `/lang`
pins a choice above that. The Telegram menu shows the same list, minus
`/subscribe`: it is one line, and a person who turns it off should not have to
find it in a menu again.

## Updates

The npm tag `latest` is a label, not an updater: installing a package pins the
version on disk, and nothing moves until something moves it. Two switches, both
about this install (not about a topic, because it is the install that updates):

| Command | What it does |
|---|---|
| `/update` | one line: what runs here, what is published, which switches are set |
| `/update on` | tell me about new releases: one message per version, checked once a day |
| `/update off` | stop telling me; nothing installs, nothing moves |
| `/update auto` | besides telling me, install the release by itself (checked hourly) |
| `/update confirm` | install the new release now, by hand |

Nothing above installs except `confirm` and `auto`, and even those only change the
files: the running process keeps its old modules until `/restart confirm`, so a
bad release never lands mid-chat. `confirm` and `auto` copy the replaced files to
`update-backup-<date>` and print the path; copying that folder back is the way to
roll back, with no state to undo.

`/subscribe on|off` says the same thing as `/update on|off`, for people who do not
want to read `/update` first. It is not in the Telegram menu on purpose.

There are no notices about failures. The bridge cannot decide what counts as one
for you, and "something failed" that nobody can act on is noise; errors stay in
the chat where they happened, under `/doctor` and `/logs errors`.

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
| photo | its path plus one honest line; the turn reads it with `read_image`, and says so in one line if it cannot |

A caption does not turn the attachment into a text-only message: it is folded into the same
hand-over, so "why did this fail" plus a `.log` file arrives as one steer.

An album is one request, not ten. Telegram delivers it as one update per file, all sharing a
`media_group_id`; the bridge collects the group (1.2 s of quiet after the last item, at most
4 s) and hands it over once — one steer into a running turn, one turn when the topic is idle.

### When a turn hits the time ceiling

`turnTimeoutMs` (default 30 min, this install 75) is a ceiling, not a target: if a turn reaches
it, the bridge stops it with `⏱` instead of letting one runaway loop own the topic for hours.
Nothing is lost — the session and every file the turn produced stay in place — so the message
carries **⏵ Continue**, which asks the agent to check the state and go on from where it stopped.
That is deliberately not the same as **Retry**, which would redo the whole task from the start.

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

### Live thoughts and reasoning

Two things land in the same progress message, and neither sends a chat message of its own.

**The model's reasoning.** Every `thinking` block the CLI commits is folded into one
Telegram `<blockquote expandable>`: collapsed it is a single line, tapped it opens the whole
trail of the turn, and it stays there after the turn ends — the same way the desktop app shows
a reasoning section you can expand. The block is written once, in the final edit of the turn,
and never touched again: Telegram re-collapses an expanded block on every edit of its message,
which used to yank the chat away from a half-read paragraph. While the turn runs the message
only gets a counter (`🧠 Размышления · 4821`) and the last three steps, so the live edits stay
short. Escaped, and trimmed to its tail when a turn thinks longer than a message can hold; the
panel never exceeds one message. A cut block says `… · начало скрыто · /thoughts file`, which
sends the whole log as a document. If the API refuses the markup, the same content is retried
as plain text.

**The steps.** Three calls fit inline. A turn that makes more moves its complete step list into
a second collapsed block, added in that same final edit, so "what did it actually run" is one
tap away instead of a count.

**The agent's own notes.** The agent can add a short decision trail:

```bash
node ~/.dsh/tg-bridge/say.mjs --thought "checking why the watchdog fired twice"
```

The note is appended to `~/.dsh/tg-bridge/thoughts/<chat>_<thread>.jsonl`; the progress
message shows the last two as `💭` lines. The command needs no ids: it falls back to the
newest turn's thought file, because tool shells do not inherit the bridge environment.
`--thought` never sends a Telegram message on its own.

A decision the person must know before the turn ends — a release shipped, a cause found,
a blocker — goes to the chat as one plain line instead:

```bash
node ~/.dsh/tg-bridge/say.mjs --note "1.10.1 is on npm; restart to load it"
```

`--note` sends a real message and takes the same no-ids fallback as `--thought`. The split
is deliberate: `--thought` is the working trail inside the progress message, `--note` is the
short line that changes what the reader expects to happen next. The progress message itself
opens with the request echoed back (`⏳ Принял: «…» · 3 с`), so the first thing the person
sees after sending names their task rather than a generic spinner.

`/reasoning` is the switch for the 💭 mechanism. It is on by default: every turn carries a
short instruction to leave one line at each decision point (task clear, cause found, risky
change, result checked). `/reasoning off` drops the instruction and the `💭` lines for that
topic — useful when the step list is all you want. The setting lives in `state.json` per topic,
so a chatty research topic and a terse deploy topic can differ.

The reasoning block itself is model output; `/thoughts` is what reads it back:

- `/thoughts` — the last turn as a message, in parts, deleted after three minutes;
- `/thoughts file` — the **whole** last turn as `reasoning-<date>-file.md`, sent as a document
  (a five-hour turn is tens of thousands of characters, which no chat message can hold);
- `/thoughts all` — every turn of the session in one file (a long session is a couple of MB);
- `/thoughts off` / `on` — keep the block out of the turn panel (the panel then shows
  `🧠 Размышления · N · /thoughts file`) or bring it back.

The log is built from the session file on demand, so nothing is duplicated while a turn runs.
Files land in `~/.dsh/tg-bridge/thoughts/` and older ones are pruned after a week.

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
`/plugins` manages that profile's rows, and `/plugins search <word>` lists what the npm registry
has with the `dsh-plugin` keyword — the desktop app's plugin browser, from the chat. Each result
carries a plus button that runs `/plugins add <name>`.

### Goals and tasks

A topic carries its own goal and checklist, so the aim survives `/new`, a
restart and a different session:

```
/goal ship the release      set or replace the goal
/goal                       show the goal and the checklist
/tasks write the migration   add a task
/tasks done 2                tick it off
/tasks edit 2 shorter words   rewrite it in place, same number
/tasks rm 2                  remove it
/goal reopen                open a closed goal again
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

- [docs/TELEGRAM-SETUP.md](https://github.com/aleksvega/dsh-tg-bridge/blob/master/docs/TELEGRAM-SETUP.md): BotFather settings, group and bot permissions
- [docs/ROADMAP.md](https://github.com/aleksvega/dsh-tg-bridge/blob/master/docs/ROADMAP.md): what comes next
- [docs/UX-ANALYSIS.md](https://github.com/aleksvega/dsh-tg-bridge/blob/master/docs/UX-ANALYSIS.md): interactive UX review
- [docs/COST.md](https://github.com/aleksvega/dsh-tg-bridge/blob/master/docs/COST.md): what one turn costs and how to reduce it
- [docs/CHANGELOG.md](https://github.com/aleksvega/dsh-tg-bridge/blob/master/docs/CHANGELOG.md): change history
- [docs/RELEASE-CRITERIA.md](https://github.com/aleksvega/dsh-tg-bridge/blob/master/docs/RELEASE-CRITERIA.md): release readiness criteria

## License

MIT, see [LICENSE](LICENSE).
