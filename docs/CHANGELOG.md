# CHANGELOG — DSH Telegram bridge

## 1.8.1 — 2026-10-25

- The turn panel respects `plainText: true`: it was sending the reasoning block as
  HTML regardless, which is exactly what someone who turned markup off does not
  want. Such an install now gets the same content without the tags.

## 1.8.0 — 2026-10-25

The settings the desktop app exposes as panels, and the reasoning it streams as a
section, reach the chat — each as one edited message instead of a stream of
notifications.

- **`/agents set model|depth|filter <value> @<tool>`** writes a delegation row in
  the profile patch: which model a child runs, its `maxDepth`, its tool filter
  (`deny:` list). A single row needs `@tool`, because a bare list of names is
  ambiguous with a filter list. An unknown tool is named back with the list of
  real rows instead of a wrong "depth" error. The patch is written atomically
  with a rolling `.bak`: it decides every later turn, so a half-written file must
  never exist.
- **`/effort`** reads the ids the route itself declares (`reasoningEfforts` in
  the model catalog), offers exactly those, shows the current one and writes or
  removes `reasoningEffort`. A value the route does not declare is refused; a
  route that declares nothing gets the value written with an explicit warning
  that nobody promised it works.
- **`/permissions`** lists the sandbox/approval presets in the profile, marks the
  current one and switches it. On an app-managed profile the table is owned by
  the bundle and the card says so instead of inventing a config row.
- **`/preset`** lists the agent presets a profile declares and switches the
  pinned registry default; a profile that declares none is described, not
  guessed at.
- **`/plan`** reads the session's plan projection: whether plan mode is on, what
  it is waiting for, and how to ask for a plan. It is read-only on purpose —
  headless cannot dispatch a mode change, and saying "off" when the truth is
  "unknown" would be worse than saying "unknown".
- **`/jobs`** is the jobs panel for this bridge: running turns with their topic,
  the queue depth and the parallelism cap. DSH jobs live inside the per-turn
  child process and die with it, so a panel that claimed otherwise would lie.
- **`/remind`** adds, lists, deletes and clears reminders (`+15m`, `+2h`, `+1d`,
  `HH:MM`). The scheduler is the bridge's own: the headless host exits after each
  turn, so a DSH schedule would never fire. Entries are per chat, capped at 20,
  and delivery is a plain message in the topic that asked.
- **Live reasoning**: the CLI's `thinking` events are folded into the turn's
  progress message as a native `<blockquote expandable>` — collapsed it is one
  line, tapped it shows the whole trail, and it stays with the turn after the
  turn ends. Edits are throttled, text is escaped, long reasoning keeps its tail
  with a "beginning hidden" note, and a rejected markup falls back to plain text
  rather than freezing the panel.
- `profile-edit.mjs` (indent-aware YAML row editor, `.bak`, atomic rename),
  `reminders.mjs` (parser + schedule helpers) and `panel.mjs` (the turn view) are
  separate modules with their own tests; the panel was split out because
  importing `bridge.mjs` claims the pid file and exits when a bridge is running.
- Six new commands in the menu and `/help` in all three languages; i18n parity is
  enforced by a test, not by review.

## 1.7.7 — 2026-10-25

- `/agents` answers the question the desktop sidebar answers: who can this
  session delegate to, on which model, how deep, with which tool filter, which
  routes a child may pick, and which children this session actually started
  (read from the catalog the delegation tools themselves publish). `/agents <id>`
  opens one child with its label, mode and the `/resume` line that continues it
  here.
- `/profile show [name]` is the profile card: model, rows in its patch, disabled
  rows, bundle count, delegation tools, child routes, and the file that owns them
  all. `/profile` alone says which profile you are on; this says whether the one
  you are about to switch to is the one you want.
- `agents.mjs` reads the delegation rows out of a profile patch (the bridge
  already edited those patches by hand for `/model` and plugin toggles). It is
  parse-only and tested, because a wrong indent assumption here reports the wrong
  model to a person setting a cost budget.
- The command menu and `/help` carry `/agents` in all three languages.

## 1.7.6 — 2026-10-25

- The status card names the session ("Название: Отвечай по игре сюда"). The
  bridge only knew the titles it had set itself, so a session resumed from the
  desktop, or seeded before the title was written, showed none — while
  `/sessions` had it all along. It now falls back to DSH's projection cache.

## 1.7.5 — 2026-10-25

- `/version` adds one line when the modules on disk are newer than the running
  process: the version number comes from `package.json`, the answers come from
  the code loaded at start, and after `sync-runtime.mjs` or `/update` those two
  disagree until `/restart confirm`. Say it instead of letting a fresh number
  read as live code.
- The `/logs` menu entry mentions `/logs file`.

## 1.7.4 — 2026-10-25

- `/logs file` sends `bridge.log` as a document instead of pasting a slice of it:
  when the question is "what exactly happened", the chat is the wrong container.
- `/logs errors` shows the bridge's own faults. It used to match every tool
  result line, so a routine non-zero exit buried the four real failures under
  four hundred lines of work the agent had already reported.
- A pending update that makes the replay throw is now logged and dropped. Before,
  it stayed in the journal forever: the bridge replayed it, died, was restarted,
  replayed it again — a crash loop every ninety seconds with nothing in the chat.
- `/logs` filtering moved into `filterLogLines()` and is covered by tests
  (seven new).

## 1.7.3 — 2026-10-25

- Report headers carry one glyph each (📊 status, 🩺 diagnostics, 🗂 sessions,
  📦 versions, 🧠 reasoning), so a chat full of answers can be scanned the way a
  dashboard is.
- `/status` says whether the agent is working right now ("Агент работает: нет
  (0 ходов)") and prints the full session id, because that id is what people copy
  into `/resume`.

## 1.7.2 — 2026-10-25

- A voice note or photo that arrived while a turn was running, but finished
  downloading after that turn ended, is now delivered as a turn of its own. It
  used to be written as a steer job and then sit in the directory until the
  watcher noticed ninety seconds later — long enough to look like the message
  was swallowed. The prepared text (transcript, file path, caption) is already
  the whole request, so it runs directly instead of re-transcribing the audio.
- An album flush no longer decides "steer or turn" from the state at upload
  time: the buffer holds photos for up to four seconds, and a turn that ended in
  that window must still get an answer.
- The mid-turn photo disclaimer ("only the path is attached") is left out when
  the text ends up as a fresh turn, where the image is readable after all.

## 1.7.1 — 2026-10-25

- `/status` is a card now, not a key dump: session title, when it was created and
  last active, how full the context is (`Context: 78,450 / 1,000,000 (8%)`, with
  the window taken from `contextWindow` in `config.json`), how many tokens the
  session billed over its whole life, how many turns it holds, and whether the
  working notes are on. The numbers come from the session log itself
  (`sessionStats` in `thoughts.mjs`), so they are right even for a session this
  process does not hold.
- `/thoughts` no longer dead-ends on a turn that planned nothing (a one-word "ok"
  has no reasoning part): it says so and shows what that turn answered instead.
- `/cd` with nothing bound printed an empty line where the directory belongs. It
  now says the bridge default is in use, or that nothing is set at all, and
  `/doctor` marks a default directory as inherited rather than silently shown.
- `sync-runtime.mjs`: one command copies the repo modules over the live bridge
  directory with a timestamped backup. Several fixes in this release had landed
  in the repo while the running copy kept the old file, so `npm test` passed and
  the bot still answered from stale code.

## 1.7.0 — 2026-10-25

- A command typed during a long turn is answered at once, not after it. The
  immediate set was a list of six "safe" reports; everything else queued, so
  `/model`, `/goal` or a mistyped command sat in the queue behind a turn that
  could run for twenty minutes — which is indistinguishable from a dead bot.
  The rule is inverted: only `/new`, `/resume`, `/seed`, `/send` and plugin
  mutations queue, because those replace or feed the session the running turn is
  writing. The list lives in `immediate.mjs`, and a test walks `CONTROL_COMMANDS`
  so a new command is never silently left in the queue.
- `/thoughts` shows what the model was thinking in the last turn, read straight
  from the session log (`thoughts.mjs` walks the zstd frames of
  `session.v4.jsonl.zstd` backwards to the last `turn/start`), so it works for any
  session, even one this process no longer holds. The reply deletes itself after
  a few minutes; so does an unknown command's menu.
- `/version` reports the bridge version, the latest on npm and where the
  bridge lives. `/update` says whether a newer release exists; `/update confirm`
  installs it into the bridge directory (fetched into a temp dir and copied over,
  with the previous files in `update-backup-*`). Until `/restart confirm` the old
  code keeps serving, so a bad release cannot take the chat down by itself.

## 1.6.0 — 2026-10-25

- A photo is read by the turn's own model, not by a second, billed one. The
  automatic switch to `vision.patch` dated from a text-only default model; a
  plain `headless` turn read the Chinese captions off a 720×1560 screenshot and
  answered with them verbatim. The overlay is now opt-in (`vision.enabled`) and
  mid-turn photos are honestly described as "here is the path" instead of "the
  model cannot see it".
- `/models` is gone from the menu: bare `/model` lists the models and
  `/model <id>` switches, the way every other command works. `/models` still
  answers as an alias so old habits do not break. `/app` and `/restart` now say
  which one restarts the desktop app and which one restarts the bridge.
- The package ships `profiles.mjs` and `cli-args.mjs`. Both are imported by
  `bridge.mjs`, and `files` in `package.json` did not list them: an install from
  npm would have died with `ERR_MODULE_NOT_FOUND` on the first turn.
- Model overlays that are materialised as profiles no longer show up in
  `/profile`, and they keep the base profile's plugins through a `node_modules`
  junction instead of booting a bare host without the steer inbox.
- Photo turns work again, and so does the fallback-model path: both passed
  `--patch` to `dsh` *after* `--json`, and the launcher hands everything from
  the first flag it does not know to the app, which rejected it with
  `unknown option '--patch'` and exited 1 in about five seconds ("CLI exited
  with code 1 and no output"). Launcher options now come first; `turnArgs()` in
  `cli-args.mjs` builds the argument list and a test pins the order.
- A button press answers in the topic's language. A callback carries no message,
  so `resolveLang` only had the config default there and answered in English
  under a Russian card ("Send /doctor — it collects the full report."). The
  first message in a topic now teaches the bridge what it speaks, the choice is
  kept in `state.lang`, and an explicit `/lang` still wins.
- The whole surface speaks en / ru / zh, not just the menu and the greeting:
  every `/command` reply in `control.mjs` (98 `ctrl.*` keys) and every runtime
  line in `bridge.mjs` — progress steps, the fallback-model notice, the failure
  explainer, approval buttons and callback answers (38 `bridge.*` keys). The
  Russian wording is unchanged; English and Chinese are new. A `/logs errors`
  filter keeps its Russian alternatives because it matches the bridge's own log
  text, not user output.
- An album is one hand-over, not ten. Telegram sends one update per file with a
  shared `media_group_id`; `albums.mjs` collects the group (1.2 s quiet, 4 s
  ceiling) and delivers it as one steer into a running turn or one turn when the
  topic is idle. Four tests cover ordering, separate albums, the ceiling and a
  single-item group.
- A turn stopped by the time ceiling is now a pause, not a dead end: the status
  message shows `⏱` with the localised explanation and a **Continue** button,
  which enqueues a continuation prompt in the same session instead of re-running
  the whole task from scratch (that is what Retry does). `runTurnLive` reports
  `reason: 'timeout'` so the button choice is made on a fact, not on parsing an
  error string.
- Attachments are a first-class part of a running turn, not just typed text.
  - A caption no longer downgrades a file to a text-only message. `handleMessage`
    only called the media helper when the message had no text, so every
    captioned document was silently dropped — idle and mid-turn alike.
  - Small text files (`.md`, `.json`, `.csv`, `.py`, `.log`, source, config, up
    to 60 KB) are pasted into the prompt as content, so a steer can use them
    without a tool round-trip; bigger or binary files keep the path.
  - Audio sent as a document is transcribed like a voice note; video, video
    notes and animations are saved under `inbox/` and handed over by path.
  - A photo steered mid-turn now carries one honest line: a running turn cannot
    apply the vision overlay, so the model says it cannot see the image instead
    of quietly ignoring it.
  - `inlineText()` lives in `media-text.mjs` with six tests.
- `/reasoning on|off` controls the `💭` decision trail per topic. On by default:
  each turn carries one instruction to leave a line at each decision point. Off
  removes both the instruction and the display, so nothing is written either.
  New i18n keys (`prompt.reasoning`, `msg.reasoning*`) in en/ru/zh.
- `/profile` ports the app's profile switcher into a topic: list, switch
  (`/profile research`), create from a shipped template
  (`/profile new research from web`), and return to the install default
  (`/profile default`). Turns, `/model`, `/plugins`, `/prices` and steering pick
  the topic's profile instead of the global one. A created profile is written
  with `dsh <name> --from-default-profile <template> --dump-config`, so nothing
  boots at creation time.
- Fixed a latent bug: `handleControl` destructured `profile` from its context but
  the bridge never passed it, so every profile-aware command silently used the
  install default.
- Steering covers attachments, not just typed text. A voice note sent while a
  turn runs is transcribed (`🎤 <transcript>` is echoed first) and the transcript
  is handed to the live agent; a photo or a file is downloaded and its local
  path is steered. Both go through the same helper an idle turn uses, so the
  agent sees the same text either way.
- The voice/photo/document conversion moved out of `handleMessage` into
  `mediaPrompt()`, which returns `{ text, extraArgs }`. A steer cannot apply the
  vision patch to a turn that is already running, so a photo steered mid-turn
  carries only its path.

## 2026-10-25 — v1.5.4

- Portability: no command depends on one provider any more.
  - `/prices` reads the public models.dev catalog; a provider page is optional
    and configured with `pricesUrl` (default `""`). The vendor was previously
    hardcoded.
  - Provider keys passed to a turn are declared per install with
    `"providerKeys": ["NAME"]` and read from `~/.dsh/.credentials.yaml`. The
    four fixed provider names are gone, so a fresh install sends no foreign keys.
  - `config.example.json` ships with `fallbackModels: []` and an empty vision
    patch instead of one vendor's free models and vision model.
- README: the command menu is installed by `init`/`setup`, not refreshed by a
  plain restart; run `dsh-tg menu` after upgrading.

## 2026-10-24 — v1.5.3

- `say.mjs --thought` no longer depends on environment variables: tool shells
  do not inherit the bridge's env, so it falls back to the newest active
  thought file and needs no chat/thread ids.

## 2026-10-24 — v1.5.2

- Fix a crash window in v1.5.1: the thought poller could fire before the
  progress scheduler was initialized. `schedule` is now a hoisted function.

## 2026-10-24 — v1.5.1

- Live thoughts: `say.mjs --thought "..."` appends a note to the turn's thought
  file, and the progress message shows the last two as `💭` lines. No extra
  Telegram messages, and chat/thread come from the turn environment.

## 2026-10-24 — v1.5.0

- Desktop-style goals per topic: `/goal <text>`, `/goal`, `/goal done`,
  `/goal clear`; `/task <text>`, `/task done <n>`, `/task rm <n>`.
- The goal and checklist are prepended to every turn, so they survive `/new`
  and a restart. The agent ticks tasks through `goal.mjs`; job files keep the
  bridge the only writer of `state.json`.
- `/status` shows goal progress; the Telegram command menu lists both commands.

## 2026-10-24 — v1.4.1

- Manifest corrected against DSH's actual compatibility gate: only
  `engines.dsh` is read, and it now carries an explicit `0.2.2-*` prerelease
  branch. The inert `dsh.manifestVersion` / `dsh.compatibility` fields are
  gone. Docs no longer present the market's display cache as the install gate.

## 2026-10-24 — v1.4.0

- The package is now a valid DSH bundle: `engines.dsh` declares the supported
  harness range, `dsh.bundle.patch` points at `cordis.patch.yml`, and
  `plugin-bridge.mjs` starts one bridge when DSH boots and stops it on
  shutdown. A live `bridge.pid` wins, so the plugin and the scheduled task
  never poll the same bot twice.
- Installation no longer embeds a GitHub account: `init` and `setup` run
  through `npx dsh-tg-bridge@latest`, and `install.sh` / `install.ps1`
  download the npm tarball instead of cloning a repository.
- README: supported harness range, ecosystem links to the Chinese DSH plugin
  catalogs, corrected autostart description (one guarded task, five-minute
  tick), no raw personal URLs.
- `docs/MARKETPLACE.md`: what the catalog checks, the exact listing entry, and
  the remaining blockers.

## 2026-10-24 — v1.3.5

- Supervisor fix: `bridge-kick.mjs` starts the bridge with `spawn()` +
  `unref()` instead of `spawnSync()`. The blocking call kept the tick alive
  for as long as the bridge ran, held `restart.lock` for hours and left the
  supervisor skipping every tick; the bridge was then started by a second
  timer without the lock, producing Telegram 409 conflicts.
- The restart lock now expires after 180 s even if its holder is alive, and a
  late holder only deletes a lock that still carries its own pid.
- Healthy ticks cost one `kill(0)`; the PowerShell process scan runs only when
  the pid file is missing or stale.
- `setup` points the scheduled task at the guarded hidden launcher
  (`wscript` + `bridge-kick.mjs`) instead of starting `node` directly, so
  starts go through the lock and no console window appears at logon.

## 2026-10-24 — v1.3.4

- `/prices` no longer assumes unorouter: it merges the unorouter page and
  models.dev, prices the model of the configured profile, answers in the
  topic language, and does not crash when both catalogs are unusable.
- `/plugins add|remove|disable|enable` launch the DSH CLI the same way turns
  do (Electron + `cli.js`); spawning the `dsh.cmd` shim failed with `EINVAL`
  on Node 20 and newer.
- `/status`, `/models` and `/model` read and write `config.profile` instead of
  a hardcoded `headless`; the desktop line appears only when that profile
  exists.
- `/sessions` follows the topic's `/cd` directory.
- Turn telemetry reports the real model instead of a hardcoded id.
- `init` writes absolute voice and vision paths, and existing configs are
  repaired at bridge start. Relative paths silently disabled voice and photos
  after a fresh install.

## 2026-10-24 — v1.3.3

- All documentation is now English: README, setup, cost, roadmap, release
  criteria, UX analysis, injection notes and changelog.
- Removed personal data from the public repo: example Telegram ids are now
  `123456789`, project examples use `my-app`, the internal status log and
  archive notes are out of the tree, and `LICENSE` names the contributors.
- `allowedUserIds` defaults to an empty list, so a config-less bridge answers
  nobody instead of one hardcoded id.
- `/cd` lists projects from `projectsDir` (default `~/Projects`) instead of a
  hardcoded Windows path.

## 2026-10-24 — v1.3.2

- A steer message is now accepted by DSH: the bridge sends a full message with
  `id: randomUUID()` and `role: 'user'`. Without them every later turn failed
  with `event at seq N lacks an identified message` and the topic stayed dead
  until the session log was repaired by hand.
- The session log backup lives next to the session file.

## 2026-10-24 — v1.3.1

- A steer message is no longer lost when a turn ends before the plugin picks
  the job up. If the job is still unclaimed 90 seconds after the turn ended,
  the bridge runs it as a separate turn. Previously it expired after 10 minutes
  and the user got nothing.
- While the turn is running the bridge rechecks once a minute and does not post
  extra messages.

## 2026-10-24 — v1.3.0

- Steer while a turn is running: a message sent mid-turn is handed to the live
  agent on its next step (`dsh-steer-inbox`) instead of waiting in the queue.
  The agent posts a short line in the topic saying what it is doing now and
  where the addition went.
- `say.mjs` sends that line; with `--steer <id>` it takes chat and topic from
  the job and marks it so the bridge does not duplicate the confirmation.
- If the mark is missing after 90 seconds the bridge posts one neutral line in
  the topic language (ru/en/zh), so silence never happens.
- Without the plugin in the profile the bridge does not write the job (it would
  expire) and behaves as before: the message joins the queue. Guarded by
  `steerAvailable()`. The plugin ships in the repo at `plugin/steer-inbox`.
- Tests: 12, three of them new (steer job write).

## 2026-10-24 — v1.2.10

- Informational commands no longer wait for a turn: `/plugins`, `/models`,
  `/sessions`, `/skills`, `/prices`, plus `/soul` and `/lang` without arguments,
  answer immediately during a long turn. Previously they queued and arrived
  twenty minutes later, which looked like a failure.
- `/plugins add|remove|disable|enable` stay queued: they change the profile and
  must not run concurrently with a turn.
- The rule lives in `immediate.mjs` and is covered by `npm test` (9 tests).

## 2026-10-24 — v1.2.9

- Fixed a race when removing the queue notice. If a turn started exactly while
  "⏳ Previous turn is running…" was being sent, the notice stayed until the
  turn ended. The staleness rule moved to `queue-notice.mjs` and has a test
  (`npm test`, 4 cases).
- `queue-notice.mjs` added to the npm package files.

## 2026-10-24 — v1.2.8

- "⏳ Previous turn is running…" no longer clutters the chat. A topic now gets
  one such message instead of one per queued message, and the bridge deletes it
  once a turn picks up the user's message.
- `send()` returns the sent message id, which is required to remove the notice.
- If deletion fails (no rights in a group) it is logged and does not affect the
  turn.

## 2026-10-24 — v1.2.7

- Localization extended to automatic messages: restart confirmation, the queue
  notice, the cache line and "…and N more" in progress, new-topic log,
  "Transcribing…" and the unknown-command hint now come from i18n (ru/en/zh).
- Removed the duplicate Russian `CONTROL_COMMAND_HINT`: the hint is built from
  `help.body` in the topic language. Dead import in `bridge.mjs` dropped.
- Dictionary audit: 53 keys × 3 languages with no missing keys or placeholder
  mismatches; the command menu holds the same 20 commands in all languages.
- Long reports (`/status`, `/sessions`, `/models`, `/plugins`, `/prices`) are
  still Russian — a planned next step.

## 2026-10-24 — documentation

- **docs/TELEGRAM-SETUP.md**: what must be enabled in Telegram for the bridge
  to behave as designed — privacy mode, topics, bot rights, `allowedUserIds`,
  a single instance, a one-minute check, and what does not need configuring.
- README: short "Telegram bot setup" block linking to the document.

## 2026-10-24 — v1.2.6

- The progress message no longer has "Stop" and "Logs" buttons: `/stop` and
  `/logs` work during a turn now, so buttons would only duplicate them. The
  "Retry", "Doctor" and permission-confirmation buttons remain.
- Handlers for the old buttons are kept so pressing a button in an already sent
  message does not fail silently.

## 2026-10-24 — v1.2.5

- No more silence after `/restart confirm`: the old process wrote "Restarting
  the bridge…", exited and said nothing. It now leaves `restart-notice.json`
  with chat and topic, and the new process replies there first with
  "✅ Bridge restarted — online (pid N)". If the replacement never starts there
  is no reply, which is the honest signal.
- The notice is deleted right after sending and ignored if older than 10 minutes.

## 2026-10-24 — v1.2.3

- `/stop` now stops a turn instead of waiting for it. Commands used the topic
  queue, so `/stop` sent during a 26-minute turn reached the handler when there
  was nothing left to stop. Six commands — `stop`, `logs`, `status`, `help`,
  `doctor`, `restart` (including glued forms) — run off-queue and do not get a
  "message queued" notice.
- Commands that change session state (`/new`, `/model`, `/lang`) still go
  through the queue.

## 2026-10-24 — v1.2.2

- The queue no longer looks like a hang: if a turn is already running, the
  notice states how long ("running for 24 min") and mentions `/stop`. It now
  arrives after 30 s instead of 45 s.
- Hard turn limit raised from none to 40 minutes (`turnTimeoutMs`), so a hung
  child process cannot hold a topic forever; the 2-minute inactivity watchdog
  remains.

## 2026-10-24 — v1.2.1

- Menu and `/plugins` changes are now in the repository. Edits that merged
  `/plugin` into `/plugins` existed only in the working directory
  `~/.dsh/tg-bridge`, while npm still shipped the old version. `control.mjs`
  and `bot-menu.mjs` were moved into the repo: 21 commands in the dispatcher
  (alias `/plugin`), 20 in the menu, `/plugins` described as
  "List and manage: add/remove/disable/enable".
- `setup` code sync can no longer revert these changes: the repository is the
  source of truth.

## 2026-10-24 — v1.2.0

- One-command install: `dsh-tg init --token <t> --user <id>` writes the token to
  `~/.dsh/.credentials.yaml` (`refs.DSH_TELEGRAM_BOT_TOKEN`), creates
  `config.json` with the user id and working directory, and checks the
  `headless` profile. Also `--cwd`, `--voice`, `--dry-run`. Other sections of
  credentials are untouched and `config.json` is never overwritten.
- Token lookup accepts any `DSH_TELEGRAM_BOT_TOKEN*` name and the environment;
  a fresh install no longer fails with "token not found" right after `init`.
- `cli.mjs` copies the code to `~/.dsh/tg-bridge` from any clone location, so
  `setup` no longer answers "bridge not found".
- Autostart in `install.sh`: `launchd` (macOS) and `systemd --user` (Linux) with
  `--no-autostart`; Windows keeps the `DSH-TG-Bridge` task and `DSH-Bridge-Kick`.
- Error codes `INSUFFICIENT_QUOTA`, `TG_CONFLICT`, `MISSING_CREDENTIAL`,
  `NO_DSH_CLI`, `NETWORK`, `SANDBOX_DENY`, `UNKNOWN_MODEL`, `EMPTY_RESPONSE`,
  `TURN_FAILED`, each with a single action at the end of the failure message.
- `/plugins` is a single command: `add/remove/disable/enable` are forwarded to
  `/plugin`, which was removed from the Telegram menu (20 commands per language).
- `/lang` added to `CONTROL_COMMANDS` (it was reported as unknown) and to the
  command hint.
- `bridgePids` compares the full script path, so a second installation with its
  own `DSH_HOME` and bot is not treated as a duplicate bridge and killed.
  `DSH_HOME`/`DSH_TG_HOME` are honoured in `bridge.mjs`, `setup.mjs` and
  `bot-menu.mjs`.

## 2026-10-24 — v1.1.0

- Three languages: `i18n.mjs` (en/ru/zh), `t()`, normalization of `zh-hans → zh`.
- Menu in three languages: `setMyCommands` for default, `en` and `zh` (Telegram
  rejects `zh-hans`).
- `/lang en|ru|zh`: language is stored per topic; a new user gets one from
  `language_code`, anything outside ru/zh falls back to `en`.
- Localized: start message, progress headers, turn failure, `/cd`, `/new`,
  `/stop`, unknown-command reply and the Stop/Logs, Retry/Doctor buttons.
- An unknown command no longer starts the model — it returns a hint.
- Watchdog: 25 s pause and pid recheck before alerting; `requireDesktop: false`
  and the alert mentions the bridge, not the desktop app.
- Fixed the i18n import in `bridge.mjs` (`resolveLang is not defined` left the
  message stuck).

## 2026-10-23

- Timeouts reworked: the hard ceiling is gone (`turnTimeoutMs: 0`), silence no
  longer kills a turn, any stdout/stderr byte extends the window, and a
  heartbeat refreshes the status every 2 idle minutes.
- Fallback chain extended to 7 models (opus-5-5, glm-5.3-flash:free,
  qwen3.6-35b-a3b, free-mimo, deepseek-v4.1-flash:free, opus-4-7, sonnet-4-7
  across the configured providers).
- New switch triggers `AUTH`, `403`, `insufficient_user_quota`, `UNKNOWN_MODEL`,
  `MISSING_CREDENTIAL`, with a chat message when falling back to a free model.
- Providers `taynik`, `neuraldeep`, `ikhdev` added to the headless profile;
  keys live in `.credentials.yaml` and are passed to the CLI child environment.
  Subagents use `unorouter/deepseek-v4.1-flash`.
- Commands come from the single `CONTROL_COMMANDS` list; `/cd`, `/prices` and
  `/seed` were missing from the old hardcoded whitelist and were sent to the
  model as plain text.
- `restart.lock` prevents `setup` and the kick from starting two pollers at once
  (the cause of 409s).
- On a "was recorded in … not …" session error the bridge resets the session and
  starts a new one.
- Docs: UX-ANALYSIS.md and ROADMAP.md updated.

## 2026-10-22

- Turn journal in `pending/` with ack after send and replay on start.
- Two-phase restart: `restart.pending` → exit(75) → supervisor; one-minute
  `DSH-Bridge-Kick`.
- `/cd` binds a topic to a project; `setup.mjs` finds bridges by pid file (an
  elevated process has an empty cmdline).
- Files: `/send` (sendDocument) and incoming documents saved to `inbox/`.
- IPv4 forced (`dns` + `net`), polling backoff, error codes `TG_NET`/`TG_POLL`.
- Sandbox: `workspace-write` with an explicit `permission` preset (the service id
  is `permission`, not `permission-presets`).
- Progress: single status message, step list, cache stats in the final message.
- Vision: gemini declares `input: [text, image]`; canary test with "red, 42".
- Config and project backups to private GitHub repositories.
