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
- **Project per topic**: `/cd my-app`, and all turns run from that directory — on
  a permission-enabled profile the sandbox is narrowed to it too, so the agent
  cannot write outside the project.
- **Goal and checklist per topic**: `/goal`, `/tasks`; both survive restarts and are prepended to every turn.
- **`/diff` — review the turn, one hunk at a time.** The working tree is split into
  files and hunks; every hunk gets two buttons: explain it, or revert just that
  hunk. A button carries a hash of the hunk it was drawn from, so a press that
  arrives after the file moved on is refused instead of touching a line nobody was
  looking at. `/diff stat` is the file list alone.
- **Live progress**: one edited message per turn — steps, a timer and the cache hit rate, plus
  the model's reasoning in a collapsed block you can tap open. A long turn adds a second
  collapsed block with every tool call, so the whole run stays in the chat as one message.
- **No lost messages**: a journal with acknowledgement and replay.
- **Knows how busy the computer is**: `/load` shows free space on the topic's disk,
  free RAM and average CPU, plus how many turns are running and waiting. `/load on`
  makes a prompt wait instead of starting while the machine is over a limit you set
  — kept, never refused, and one press sends it anyway.
- **Settings per topic**: `/crew use reviewer` gives one topic its own model,
  effort, permissions, agent preset and language while the others keep the profile;
  `/crew off` returns it. Four built-in sets ship read-only and can be copied.
- **Fail-fast**: when the quota runs out it switches to a free model right away.
- **`dsh-tg check`**: diagnostics in one command, no changes to the system.
- **Languages**: menus and service messages in `en`, `ru`, `zh`; `/lang` pins the topic language, and without it a new topic takes the language of the message itself (Cyrillic → `ru`, Han characters → `zh`), then the Telegram `language_code`, then `en`.
- **"Stop"/"Retry" buttons, tool confirmations**: right in the message, no commands to type.
- **`/report`**: one command turns "it broke" into a redacted document — version,
  profile, preset, model, directory, the last failure and the log tail, with
  tokens, keys and home paths removed before the file is written.

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

### What it needs from DSH

The bridge is a client of the DSH CLI, and the surface it uses is small enough to
write down: `--profile`, `--json`, `--session-id`, `--expose-internals <cli.js>`
when the app binary runs the CLI, and the `{"type": ...}` JSON events on stdout.
Profiles are read as files (`cordis.patch.yml`, `package.json`) under
`~/.dsh/profiles`. `package.json` spells the supported range out in
`engines.dsh`, and it is capped below `0.3.0` on purpose: a minor bump may rename
an event, and a bridge that guesses is a bridge that answers with silence.

Two escape hatches, for a moved app or a DSH that ships differently:

```bash
DSH_BIN=/usr/local/bin/dsh        # the CLI itself, no entrypoint argument
DSH_CLI_JS=/opt/dsh/lib/cli.js    # just the CLI entrypoint, run by DSH_BIN
DSH_APP_DIR=/opt/DeepSeek-Harness # where the desktop app is installed
```

`/doctor` prints the command a turn would actually run, so a machine where these
matter says so instead of failing with an empty answer.

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
| `pricesUrl` | retired: `/prices` always reads OpenRouter's public list and labels the number as a reference for the model |
| `vision.patch` | opt-in overlay profile for photo turns; default `""` — the turn's own model reads images |
| `vision.enabled` | set `true` to run photo turns on `vision.patch` instead of the topic profile |
| `fallbackModels` | ordered failover chain; default `[]` — see below |
| `fallbackEnabled` | `false` switches the whole chain off without editing the list; `/fallback off` sets it |
| `maxParallel` | how many topics run at once, 1–8, default `3`; also `/jobs 5` in the chat |
| `replayWindowMs` | how old a journaled update may be and still be replayed after a restart; default `600000` (10 min) |

Each `fallbackModels` entry is one attempt, tried in order after the turn's own
model refuses:

```json
{
  "provider": "router-a",
  "model": "some-model",
  "patch": "~/.dsh/tg-bridge/model-a.yml",
  "free": false,
  "off": false
}
```

`patch` is an overlay file with a single `agent-default-model` row
(`provider` + `model`); it is materialised once as its own profile, so the turn
keeps every other setting and only the model changes. `provider` is the id the
provider is written under in the profile — it decides whose key and host the
pre-flight probe asks, so the same model id on two routers stays two attempts.
`free` only adds `(free)` to the switch notice. `off` keeps an entry in the list
but out of the walk; an entry whose `patch` file is missing is skipped the same
way, and the chat says so instead of counting it.

The chain may mix companies: a 503 from one provider says nothing about another,
so a busy channel skips its own models and the next company is still tried. Put
models from different companies next to each other — two arms of one router are
one outage, not two chances — and keep the `:free` models at the end, as the
last resort.

**What starts a switch.** Anything the provider itself says no to: a 400/413/422
refusal (its own validator rejecting the request), 401/403 (key refused), 402 or
a quota/balance message (empty account), 404 (that model id is not carried),
429 (rate limit), 5xx and `get_channel_failed` / "all providers busy" (the pool
is down), a dropped connection or DNS/TLS failure, and an empty answer. A refusal
gets one other route, not the whole chain: it is replayed in full, and if the
second vendor refuses identically the request — not the route — is what is wrong,
so the reply says to start a fresh session with `/new`.

**What does not start a switch.** The turn time cap, `/stop`, a session or
directory error, a missing `dsh` binary: no other vendor changes those, and a
replay would cost a full turn to learn the same thing. They are listed in the
card so the distinction is visible instead of guessed.

### `/fallback` — the chain from the chat

```
/fallback                 the card: chain state, numbered routes, what starts a switch
/fallback on | off        the whole chain (per route: /fallback off 3)
/fallback use 3 | skip 3  one route back in or out
/fallback up 3 | down 3   move a route in the order
/fallback test [3]        ask each route (or one) with a 1-token request
/fallback add <provider>/<model>     write an overlay and append the route
/fallback first <provider>/<model>   put it at the head: tried before every other route
/fallback remove 3        drop a route from the list (its overlay file stays)
```

Every line has a button on the card: `● n` switches a route, `↑ n` / `↓ n` move
it, and the card redraws in place after each press. `test` proves the key and the
channel are alive — not that the provider accepts this conversation, so a route
can answer `ping` and still refuse a long prompt with a 400. The card says that
in as many words.

`test` also times each route: how long it takes to produce the first token, and
which live route is fastest right now. Two routes that both answer are not
equally good — 400 ms and 9 s feel like different products — and the head of the
chain is the one a person picks on that number. A route that did not answer
prints no time, so `no balance · 120 ms` can never read as "works, just slow".

`first` exists because `add` appends: when the route you want should answer
*before* the primary, appending it means moving it up eight times and guessing
where the head is. `/fallback first router-a/deepseek-v4.1-flash` writes the
same overlay and puts it at position 1 — or moves it there if it is already in
the chain.

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
| `/update` | which bridge runs, what npm has, and whether a newer release exists (`/update confirm` installs it) |
| `/thoughts [file\|all\|off]` | the last turn's reasoning as a message; `file`/`all` send the full log as a Markdown document, `off` hides the block |
| `/help` | commands grouped by category |
| `/cd my-app` | topic bound to the project, and the sandbox narrowed to it |
| `/diff [stat]` | what the turn changed, one hunk at a time: every hunk has "explain" and "revert this hunk"; a stale button is refused |
| `/report` | a redacted bundle (version, profile, preset, model, cwd, last failure, log tail) sent to the owner as a document; in a group, the path only |
| `/prices` | what the current model costs, and whose price that is: your provider's, the same model on another gateway, or "no public price" when nobody publishes one |

## Commands

```
Work:         /cd · /new · /stop · /send · /seed · /diff
Goals:        /goal (plan + checklist) · /goal reopen · /tasks (checklist only) · /tasks done|rm|edit <n>
Sessions:     /status · /sessions · /sessions <id> · /rewind [n|undo|fork [n]|branches]
Agents:       /agents · /agents <id> · /agents set model|depth|filter
Models:       /model · /model <id> · /prices
Tuning:       /effort · /permissions · /preset · /plan · /jobs · /remind
Profiles:     /profile · /profile <name> · /profile new <name> from <template>
Sets:         /crew · /crew use|off|new|copy|rm · /crew model <v>
Extensions:   /skills · /plugins · /plugins search <word> · /plugins disable|enable <id> · /soul
Updates:      /update · /update confirm · /update on|off|check|auto · /subscribe on|off
Diagnostics:  /doctor · /logs [errors|N|text] · /report
Service:      /app · /restart · /help
Machine:      /load · /load on|off · /load limit cpu|ram|disk <n>
Settings:     /settings — the same switches as buttons, grouped in four tabs
Display:      /lang · /reasoning off|card|chat · /pin on|off · /thoughts
```

### Settings as a card

`/settings` draws the same switches that the commands set, in one message with
four tabs: what the bot says, who answers and how hard it works, new releases,
and the health checks. Each row shows what the setting is now and what a tap
would change it to. A tap runs the command a person would have typed
(`/reasoning chat`, `/update on`), so the card cannot disagree with the command:
it is a view of them.

The card stays after a tap. It is edited in place — same message, same buttons,
the value in force marked with `●` and one `✓ row: value` line saying what just
changed — so a second setting is one more tap instead of a second `/settings`.
`✓ Done` removes the card when you are finished with it; nothing else deletes it.

`📌 Pin the progress card` (`/pin on`) keeps the running card pinned, so the
clock, the speed and the step list are one tap away instead of a scroll. Telegram
gives a chat one pinned message, so each turn's card replaces the last one. Off by
default: a bot that pins without being asked takes that slot in someone else's
chat, and a group needs the right to pin at all.

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

| Sent | Inside the turn | Needs |
|---|---|---|
| voice note, audio file, audio sent as a document | transcript, echoed as `🎤 …` before the steer | `faster-whisper` on `PATH`, enabled with `init --voice`; **off by default** |
| small text file (`.md`, `.json`, `.csv`, `.py`, `.log`, … up to 60 KB) | the content itself between `<file>` markers — no tool call needed | nothing |
| PDF, archive, binary, anything bigger | its local path under `~/.dsh/tg-bridge/inbox/` | nothing; the agent opens it with its own tools |
| video, video note, animation | its path; the agent can pull frames or sound out with ffmpeg | ffmpeg, only if frames or audio are needed |
| photo | its path plus one honest line; the turn reads it with `read_image`, and says so in one line if it cannot | a model that accepts images |

Voice is the one row with a hidden prerequisite. Without `faster-whisper`
installed, a voice note still arrives — as a path the agent cannot read — so the
bridge says transcription is off instead of pretending it heard something. Run
`dsh-tg init --voice` after installing the transcriber; nothing else changes.

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
`--thought` sends a Telegram message of its own only in `/reasoning chat` mode.

A decision the person must know before the turn ends — a release shipped, a cause found,
a blocker — goes to the chat as one plain line instead:

```bash
node ~/.dsh/tg-bridge/say.mjs --note "1.10.1 is on npm; restart to load it"
```

`--note` sends a real message and takes the same no-ids fallback as `--thought`. The split
is deliberate: `--thought` is the working trail (inside the progress message, and in `chat`
mode also as its own messages), `--note` is the short line that changes what the reader
expects to happen next — useful in `card` and `off` mode, redundant in `chat`. The progress
message itself opens with the request echoed back (`⏳ Принял: «…» · 3 с`), so the first
thing the person sees after sending names their task rather than a generic spinner.

`/reasoning` is the switch for the 💭 mechanism, and it has three ends:

- `/reasoning card` (the default) — every turn carries a short instruction to leave one line
  at each decision point (task clear, cause found, risky change, result checked), and the
  progress message shows the last two;
- `/reasoning chat` — the same lines, each also posted as its own message, so a turn that
  runs for twenty minutes is read as it happens instead of scrolled back to afterwards.
  The prompt says so explicitly, so a line is written to stand alone;
- `/reasoning off` — drops the instruction and the `💭` lines for that topic, for when the
  step list is all you want.

A topic switched to `chat` mid-turn does not dump the steps already in the card: forwarding
starts with the next line written. The setting lives in `state.json` per topic, so a chatty
research topic and a terse deploy topic can differ; a `true`/`false` written by an older
release still reads as `card`/`off`. The settings card offers the same three ends as buttons.

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

### The directory a topic writes in

`/cd my-app` does two things, and they are worth separating because they used to
be one: the turn runs *in* that directory, and the sandbox *stops* at it. The
second half only works on a profile that has a permission table — the bridge
writes the row only when one exists, and never invents one for a profile that
opted out.

```
/cd my-app            bind the topic: run here, and write only here
/cd ~/Projects/api wide   run here, but do not narrow the sandbox
/cd reset             unbind; the topic goes back to config.cwd
/cd                   what this topic is bound to, and how
```

| Sandbox mode | Writes inside the root | Writes outside the root |
|---|---|---|
| `read-only` | denied | denied |
| `workspace-write` | allowed | denied |
| `danger-full-access` | allowed | allowed |

`workspaceRoot` is the boundary, and it holds even when the turn switches its own
working directory: the refusal follows the configured root, not the directory the
agent moved to. That is the point — a model that wanders into another project
gets a refusal instead of a write.

Three things this table does **not** say, because measurement disagreed with the
obvious reading:

- the sandbox row alone changes nothing. `mode: read-only` in the
  `sandbox-policy` row plus `defaultPreset: danger-full-access` in the permission
  table still wrote outside the root. The permission table wins; the sandbox row
  is a default for a profile that has no table.
- `danger-full-access` therefore has to be chosen on purpose, per topic
  (`/permissions danger-full-access`), and it is the only mode that reaches
  outside the root.
- a preset with `approval: ask` cannot be used from a chat at all: a headless
  turn has no approval channel, so the escalation fails closed and the turn
  errors. `/permissions` lists such a preset with the reason instead of letting
  someone pick a trap.

Stock installs are not permission-enabled: `cordis.patch.yml` ships with the
`tg-bridge` plugin row only, so `/cd` binds the directory and `/permissions`
edits the profile-wide preset, exactly as before. The per-topic behaviour starts
the first time a profile gains a permission table.

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
- [docs/SUPPORT.md](https://github.com/aleksvega/dsh-tg-bridge/blob/master/docs/SUPPORT.md): what to send with a bug report, what never to send, and the one-line answer for "the bot went silent"
- [docs/ROADMAP.md](https://github.com/aleksvega/dsh-tg-bridge/blob/master/docs/ROADMAP.md): what comes next
- [docs/UX-ANALYSIS.md](https://github.com/aleksvega/dsh-tg-bridge/blob/master/docs/UX-ANALYSIS.md): interactive UX review
- [docs/COST.md](https://github.com/aleksvega/dsh-tg-bridge/blob/master/docs/COST.md): what one turn costs and how to reduce it
- [docs/CHANGELOG.md](https://github.com/aleksvega/dsh-tg-bridge/blob/master/docs/CHANGELOG.md): change history
- [docs/RELEASE-CRITERIA.md](https://github.com/aleksvega/dsh-tg-bridge/blob/master/docs/RELEASE-CRITERIA.md): release readiness criteria

## License

MIT, see [LICENSE](LICENSE).
