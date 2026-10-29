# CHANGELOG — DSH Telegram bridge

## 1.27.0

- **A restart no longer leaves other topics guessing.** `/restart confirm` now
  records which turns it is about to kill, and the new process posts one line in
  each of those topics: the turn was stopped, the session is intact, send the
  message again. Before, the card there stayed on ⏳ forever and nothing said why.
  The note itself had been written to the wrong directory since it was introduced
  (`control/` instead of the bridge root), so even the "back online" confirmation
  after a restart was silently lost — that is fixed too.
- **`/fallback test` measures the wait, not just the verdict.** Each live route
  now reports milliseconds to the first token and the fastest one is named once.
  Two routes that both answer are not equally good, and the head of the chain is
  chosen on that number. A route that did not answer prints no time, so
  `no balance · 120 ms` can never read as "works, just slow". The probe streams
  and stops at the first chunk; a provider that ignores `stream` is still read as
  the plain JSON answer it is.
- **`/fallback first <provider>/<model>`** puts a route at the head of the chain,
  or moves it there if it is already in the list. `add` appends, which is right
  for a spare and wrong for the route that should answer before the primary:
  moving it up eight times was eight presses and a guess about where the head is.
- **`/model provider/model` moves the route as well as the model.** Asking for
  the same model on a different provider used to rewrite only the model name and
  silently keep the old host — the one case where "I changed the model" and "the
  answers come from somewhere else now" are different claims. The reply now names
  the route the patch actually carries, and a provider the profile does not
  declare is refused before the file is touched.
- **A flaky album test is no longer flaky.** Its quiet window was 60 ms against
  10 ms gaps, so a busy machine failed a test about ordering because of the clock.
- **`/stop` stops looking like a crash.** A turn killed on purpose was reported as
  a failure, twice over: the card said «сбой хода», and the sentence underneath
  read `CLI завершился с кодом {code} без вывода` — with the placeholder still in
  it, because a killed child reports `code === null` and the formatter only fills
  the variables it is given a value for. A deliberate stop is now its own outcome
  (`turn-outcome.mjs`), the card says the turn stopped and the session is intact,
  and an unknown exit code prints as `?` rather than as `{code}`.
- **`/load`: the machine's own numbers, and a limit that holds a turn.** This
  bridge runs on somebody's desktop, next to whatever else that desktop is for. The
  card shows free space on the disk the topic writes to, free RAM, average CPU
  since the last reading, how many turn slots are busy and how many prompts are
  waiting — the one row Task Manager cannot answer, because it sees Electron
  children and not Telegram topics. `/load on` makes a prompt that arrives while
  the machine is over a limit wait instead of starting: the message is kept, not
  refused, and one press sends it anyway. Limits are `/load limit cpu 80`,
  `limit ram 10`, `limit disk 20`; the guard ships off, so an upgrade never holds
  a turn nobody asked it to hold.

## 1.26.1

- **The card's buttons work again.** 1.26.0 taught a switch press which page to
  redraw, and the caller read "has a page" as "show me that page": every switch
  redrew an identical card, Telegram refused the no-op edit, and the tap changed
  nothing at all. No error in the chat, no reply — a dead button. The two actions
  are now named apart (`tab` for the view, `command` for the setting), and a test
  fails if a switch ever looks like a tab again.
- **Tapping the tab you are on is quiet.** Telegram refuses an edit that changes
  nothing; that refusal was logged as a failure and looked like a broken button.
- **A topic without a name says its id.** The head read "Тема: тема {n}" whenever
  the name was not cached yet — the first turn after a restart always raced the
  cache, and the literal `{n}` looked like a template that forgot to render. It
  now says `Тема: id 337382`, in all three languages.

## 1.26.0

- **The settings card stays.** A tap used to turn the whole card into one line
  naming the change, which answered "what did I just do" and took away "what can
  I do next": the menu vanished the moment it was used, and the answer to a door
  like `/jobs` landed as a separate message while the line above it claimed the
  press had only been recorded. A press now edits the card in place — same
  message, same buttons — with the new value marked and one `✓ row: value` line
  above the rows. A door's answer arrives under the card, which is where it
  belonged all along.
- **A way out is a button, not a chore.** The card gained a full-width `✓ Done`
  row that deletes the message. Before, "close it" meant deleting a chat message
  by hand, and a card that cannot be put away is a card people learn to fear.
- **Only the value in force is marked.** Both the text row and the button now
  carry `●` on the end that is on, and nothing at all on the ends that are not.
  The old `○`/`●` pair marked every option, which said nothing about which one a
  tap had left in place.
- **`/pin on|off` — the progress card in the pinned slot.** Telegram gives a chat
  one pinned message, so the running card takes it and each turn's card replaces
  the last: the clock, the speed and the steps are one tap away instead of a
  scroll back. Off by default — pinning someone's chat uninvited is not a favour,
  and a group needs the right to pin at all. The pin is silent, a refusal is
  logged rather than shown, and `state.pin` reads `true`/`false` from an older
  file the way the notes switch does.
- **A failed press says so on the card.** The redraw alone looks exactly like
  success, so an error from the command behind the button is shown as `⚠️` in the
  card's note line and is not repeated underneath it.
- **Two more doors on the agent tab**: `/cd` (which folder the topic works in) and
  `/fallback` (who answers when a provider refuses), because both were reachable
  only by remembering their names.
- Dead code out: the `reasoningOf` reader had no callers since the notes switch
  moved to `notes.mjs`; the paths it was threaded through are gone.

## 1.25.3

- **The decision trail can reach the chat itself.** `/reasoning` had two ends,
  on and off, and "on" meant the last two 💭 lines inside the progress message —
  which a person only sees if they are looking at that one message. It now has
  three: `card` (the default, unchanged), `chat` (every line also arrives as its
  own message, so a twenty-minute turn is read while it runs instead of scrolled
  back to afterwards) and `off`. One switch, one name: a separate `/notify` would
  have been the second name for one job that this surface spent a release
  removing.
- **The prompt knows which end is on.** In `chat` mode every turn says so, so a
  line is written to stand alone — and says what must never be in one: a token, a
  key, a private path. The line reaches a chat, not a grey card.
- **A switch mid-turn does not replay the card.** Turning `chat` on while a turn
  runs forwards from the next line written, not the ten already on screen; a turn
  that starts in `chat` forwards from its first line. The forwarder keeps a set of
  what went out, so an edit of the card never repeats a step, and a failed send
  leaves the note in the card where it always lived.
- **The old value still reads.** `state.json` written by an earlier release holds
  `true`/`false` for this switch; they now mean `card`/`off`, and `/reasoning on`
  is still accepted as the old spelling of the card. A settings file must not need
  editing by hand after an update.
- The settings card offers the three ends as buttons and marks the current one,
  `/status` names the mode in words, and `test/notes.test.mjs` pins the mode
  migration and the "every line of the turn, not just the two the card shows".

## 1.25.2

- **A throttled route is no longer called a refused key.** The first live
  `/fallback test` on a free route came back `key refused` while the provider's
  own sentence said "This model is at its provider's per minute limit right
  now" — the probe read the HTTP status before the words, and one router answers
  a rate limit with a 403. That verdict sends a person to re-enter a key that
  works. The words about a limit now win over the status; a bare 401/403 is
  still a refused key, an empty balance still outranks both, and a 5xx with no
  words of its own is `busy` instead of `unknown`.
- **`/fallback test` asks the routes at once.** Seven routes at a 15-second
  timeout each is nearly two minutes of a command that looks frozen, with the
  poller waiting behind it. One round of requests answers in the time of the
  slowest route — and a rate limit on the router is itself a verdict, so a burst
  of probes was the wrong way to learn about throttling.
- `test/probe-verdict.test.mjs` pins the four answers that used to be confused:
  a limit behind a 403, a bare 403, an empty balance behind a 429, a 5xx with
  no body.

## 1.25.1

- **The failover chain fires on a refusal.** A turn that ended with
  `dsh: INVALID_REQUEST: wikivibe API error (400)` stopped the walk on its first
  iteration while six configured routes sat unused, and the log said nothing —
  the trigger list knew 5xx, quota words, `AUTH` and an empty answer, and a 400
  from a vendor's own validator matched none of them. Failures are now grouped
  into named families (`refused`, `quota`, `auth`, `busy`, `rate`, `transport`,
  `model`, `empty`), every family starts the chain, and every decision writes one
  `fallback …` line, so "no route was left" can no longer look like "no route was
  ever tried". The negative list stays explicit: the turn time cap, `/stop`, a
  session or directory error and a missing `dsh` are not a route's fault and are
  not replayed on six vendors.
- **A refusal costs one route, not the whole chain.** A 400 is replayed in full —
  the same long conversation, the same tools — so one other vendor answers the
  only useful question, "is it this route or this prompt". If the second refuses
  identically the request is what is wrong, and the reply now says so and points
  at `/new` instead of suggesting a top-up. Busy, quota, rate and transport
  failures keep walking the whole chain: those are per-route facts.
- **`/fallback`: the chain as a card.** The list was invisible from the chat, so
  the honest answer to "why did it not switch" was often "nothing was configured
  to switch to". The card shows the route this topic answers on, the numbered
  chain, how many routes a turn would really try (a switched-off route and one
  whose overlay file is missing are counted separately, not silently), what
  starts a switch and what does not. Every line has a button: `● n` switches a
  route off or on, `↑ n` / `↓ n` move it, `test` asks each route with a 1-token
  request, `add <provider>/<model>` writes the overlay and appends the route,
  `remove` asks for a second named press. A press and a typed line run the same
  verb, so the two cannot disagree.
- **`/fallback test` is honest about what it proves.** A probe shows the key and
  the channel are alive; it does not show the provider accepts this conversation,
  and the card says exactly that — a route that answers `ping` can still refuse a
  long prompt with a 400.
- **`fallbackEnabled`** switches the whole chain off without editing the list,
  and `runFallbackChain` reads it before sending anything, so a person who turned
  the chain off never sees a "running on another model" line. `off: true` does the
  same for one entry; both keep the route in `config.json` with its overlay.
- **`/report` prints the chain the card shows**, from the same renderer: a report
  that counted routes a turn would skip is the report that hides the bug it was
  opened for.
- `ctrl.fallback.*` moved into its own locale table (`i18n/<lang>/fallback.mjs`)
  when `ctrl.mjs` reached the 500-line ceiling; `/help` documents the command and
  the panel carries it under "Talk".

## 1.25.0

- **A bound topic no longer writes the whole home directory.** `/cd my-app` used
  to change only the turn's working directory: the sandbox still pointed at the
  profile's own root, so a model that wandered into a sibling project was allowed
  to write there. On a permission-enabled profile `/cd` now writes
  `sandbox-policy.workspaceRoot` with the same directory, which makes the
  boundary real — measured, not assumed: a write outside the root comes back as
  `[sandbox: file access denied under workspace-write mode]`, and switching the
  turn's own `working-directory` does not move the boundary. `danger-full-access`
  is now an explicit per-topic choice (`/cd <dir> wide`, or `/permissions
  danger-full-access`) instead of the quiet default. A profile with no permission
  table keeps the old behaviour, and `/cd` says which of the two it is doing.
- **One row is not a setting.** The `sandbox-policy` row alone is ignored when the
  profile also has a permission table: `mode: read-only` next to `defaultPreset:
  danger-full-access` still wrote outside the root. Both rows are now written by
  one function (`permission-rows.mjs`) from one preset, so a file cannot end up
  disagreeing with itself, and `/permissions` reads the *effective* preset rather
  than the table's current value. A preset with `approval: ask` is listed with the
  reason it cannot be used from a chat — a headless turn has no approval channel,
  and picking it used to mean a turn that failed closed.
- **Per-topic permissions.** A topic bound to an agent set gets that set's preset
  on its own derived profile, so two topics can hold two presets without reading
  each other's row. `/permissions` writes the set when the topic is bound and the
  profile when it is not, and says which. `/settings` shows the topic's effective
  preset, not the install's.
- **`/cd` survives a real filesystem.** Resolution moved into `control/cd-path.mjs`
  as a pure function: `~`, a drive letter, a UNC path, a POSIX absolute path, a
  bare project name under `projectsDir`, a relative path, `reset` — and the three
  failures a chat actually hits (empty, missing, exists-but-is-a-file) each get
  their own sentence. A bound directory that disappeared is reported as such
  instead of silently falling back to `config.cwd`.
- **`/report` turns "it broke" into data.** One command collects version, node,
  platform, profile, preset, model, fallback chain, cwd, the turn's tool names,
  the topic's last failure and the last 120 log lines — then removes tokens, bot
  tokens, `Bearer` headers, private keys, home paths, chat ids, machine ids and
  email addresses before writing the file. In a direct chat it arrives as a
  document; in a group the answer is the path only. `test/report.test.mjs` runs
  the repo's own `scan-secrets.mjs` rules over a fixture that looks like a real
  log tail and fails if a single rule matches. `docs/SUPPORT.md` says what to
  send, what never to send, and how to tell the three kinds of silence apart.
- **The docs say what is true.** README gained the three sandbox modes with what
  each one actually allows, the measured note that the sandbox row alone changes
  nothing, and an attachment table that names the one hidden prerequisite: voice
  needs `faster-whisper` and is off by default.

## 1.24.0

- **The fallback chain could not cross providers.** `model-probe.mjs` read the
  *first* provider block of the profile and asked that host about every model in
  the chain. With one router that was right; the moment the chain mixed
  companies it became the bug: a 503 from the first router was reported as the
  verdict for a model that lives on a different company's host, and
  `handle-message.mjs` stopped the chain after one probe. The log of a live turn
  says it plainly — `channel down after 2 model(s): probe says ok; not trying
  kimi-k3:free`, then `all fallbacks exhausted … : 3 probe=n/a`, while a working
  provider sat right behind it. `providerFor(id)` now returns the named
  provider's row, `probeModel(model, { provider })` asks that company, and each
  entry is probed on its own route, so a dead pool skips only its own models.
- **A chain that mixes companies is a documented shape.** Each `fallbackModels`
  entry may carry `provider`, and the switch notice names the route as
  `provider/model`, because the same model id on two routers is two different
  attempts. README explains the overlay file, the ordering rule (different
  companies next to each other, `:free` last) and why one vendor twice in a row
  is one outage rather than two chances.
- **The walk lives in `fallback.mjs`.** `handle-message.mjs` was at the 500-line
  ceiling and the chain is a decision of its own — which model, on whose route,
  and when to stop asking. Its three regexes and the give-up condition are now
  exported and tested as data (`test/fallback-chain.test.mjs`), including the
  case that used to be silent: a short chain with no verdict must not claim
  "all models are unavailable".

## 1.23.0

- **Buttons were never sent.** Every card built its keyboard as `{ text, data }`
  — a payload, not a Telegram field. Telegram wants `callback_data` and rejects
  the *entire message* when it sees `data`, and every send wrapped its API call
  in `.catch(() => {})`, so `/menu`, `/settings` and the task card drew nothing
  for four releases and said nothing about it. One conversion now happens at the
  transport edge (`inlineKeyboard`), a button with no payload is dropped instead
  of sinking the message, and a keyboard Telegram refuses is logged and retried
  as text without buttons. Verified against the live API, not only in a test.
- **One typed command, one answer — across restarts.** `/update confirm` on
  1.22.0 installed the release and then threw on an undefined name. It was never
  acked, so it stayed in the journal; each restart replayed it, it threw again,
  and one command produced "already on 1.22.0" three times. A command that
  throws is now answered in one line and acked, a replayed turn gets exactly one
  retry, and a journal entry older than the replay window is dropped instead of
  being re-run as a fresh turn.
- **The parallel ceiling is reachable from the chat.** It was a config-file key
  (`maxParallel`, 1–8) nobody could find; a fourth topic simply said "waiting for
  a free slot" with no way to widen it. `/jobs 5` sets it, the `/jobs` card
  carries a row of buttons for 1–8, and both go through one function, so a tap
  cannot store a value the command would refuse. Written to `config.json`; a
  failed write still applies to the running process and says so.
- **Three refactor casualties that `node --check` cannot see.** `saveState` was
  called but never destructured in `cmd-bridge.mjs` and `cmd-plugin.mjs`, `tg`
  was used but not imported in `steer.mjs`, and `deliverTurn` had been renamed to
  `redeliver` while two call sites kept the old name. A new guard test
  (`test/unresolved-calls.test.mjs`) scans every shipped module for a call to a
  helper it neither declares nor imports.

## 1.22.0

- **💭 notes actually reach the progress card.** Two files exist for one topic:
  the turn's own (`DSH_TG_THOUGHT`) and the stable per-topic one that `say.mjs`
  writes whenever the tool shell lost the bridge's environment. The card read
  only the first, so the block stayed empty while the file on disk kept growing.
  Both are read now, filtered by the turn's start time, deduplicated, and a
  previous turn's line can no longer surface as this turn's decision.
- **A turn that waits for a slot says so.** The parallel cap was a hard 3 and a
  fourth topic waited in total silence — not even "queued", which reads exactly
  like a dead bot. The cap is `config.maxParallel` (1–8, default 3) and a waiting
  turn posts one line in its own topic, removed the moment it starts.
- **The notes instruction is not optional any more.** The per-turn prompt used
  to offer "skip it for one-step work", which turned into skipping it always.
  Now: a 💭 line at each decision point, and a `--note` line for the four things
  a person must not have to ask about — a release, a root cause, a blocker, and
  a turn running longer than a couple of minutes.

## 1.21.1

- **The task list no longer freezes at 30.** The cap counted finished tasks as
  well as open ones, so once a goal ran long every new task was rejected in
  silence and the checklist stopped matching the work — the agent kept working
  while the list stood still. The cap is now on open work; ticked entries stay
  as history, and a goal that runs for months trims its oldest closed lines
  instead of refusing new ones. A rejected add says why in the log
  (`task rejected: 30 open`) instead of looking like a lost file.

## 1.21.0

- **Four commands became two, and the argument picks the variant.** Going back
  was `/rewind` + `/fork` + `/branches` — three names for one job, and the
  desktop app calls all of it branching. It is now `/rewind 2` (cut),
  `/rewind fork [n]` (copy), `/rewind branches` (list). Switching a session is
  `/sessions <id>` instead of a separate `/resume`, and "am I current?" is
  `/update`, which now opens with the version card instead of needing
  `/version` first.
- **The old spellings still work and are never advertised.** `control.mjs`
  rewrites them into the verb and its argument, and logs the rewrite, so an
  instruction written down months ago does not turn into an AI turn. `/help`
  and the panel list the two names; `menu-card.mjs` lost three buttons and no
  section fell below a usable size.
- **`/help <command>` answers for the merged name too**: asking about `/fork`
  explains `/rewind`, because the sentence belongs to the job, not the spelling.
- **One card for versions.** `/update` prints the bridge version, what npm has,
  the install directory and the update mode in a single message; the second
  half of that answer used to require a second command.

## 1.20.6

- **All three locales checked, string by string.** 663 keys in each of `en`,
  `ru`, `zh`: the same keys, the same placeholders, nothing empty, no mojibake.
  Two real defects came out of it.
- **`/help tasks` printed literal double quotes** around its sentence in every
  language — the string was written as a JS literal that already contained
  quotes, and nothing looked at the shape of a translated string, only at
  whether the key existed.
- **The Russian plugin list said "(disabled)" in English.** Now "(отключён)".
- A new test guards the shape rather than the key set: no string may be wrapped
  in ASCII quotes, none may leak `undefined`/`NaN` or an unsubstituted `${…}`,
  and a Russian or Chinese string may not be the English one unless it is pure
  formatting, a product name, or a model id.

## 1.20.5

- **`/prices` has one source: OpenRouter.** The card used to mix models.dev with
  a scraped provider page, and could print `$0.0000` for the model the install
  actually runs — a free mirror standing in for a real price. A price that is
  wrong is worse than no price, because it gets believed.
- **The number is labelled as a reference.** A private route (unorouter,
  wikivibe, any reseller) does not publish its own tariff, so the card shows
  OpenRouter's rate for the same model id and says in words that this is the
  market rate, not the invoice: `deepseek/deepseek-v4.1-flash — reference:
  OpenRouter price for the same model, not your route`. The id stays visible so
  the number can be checked in one click.
- `pricesUrl` is retired: a second catalog only reintroduced the bug it was
  meant to fix — two numbers for one model, and a guess about which is yours.

## 1.20.4

- **A prompt written in General ("Все") now starts its own topic.** The old
  lobby rule moved such a message into the most recently active topic — so text
  typed into the main stream ran in whatever project happened to be touched
  last, and the answer appeared in a conversation the person was not looking at.
  The owner hit this twice, once with a voice message.
- **The topic is named from the first words of the message.** Six words or forty
  characters, whichever comes first, cut with an ellipsis; media without a
  caption gets a neutral name. A title is a handle in a sidebar, not a summary.
- **The message itself becomes the first message of the topic.** It is copied
  with `copyMessage` — media included, no "forwarded from" header — and pinned,
  which also pins the topic to the top of the list. The copy is recorded as the
  topic seed, so the duplicate guard does not answer the same text twice.
- **Commands are not prompts.** `/status` typed in General still answers where it
  was typed; a state-changing command is still refused with the name of the
  topic it would have changed. Only text without a leading slash opens a topic.
- If Telegram refuses to create the topic (no topic permission, a rate limit),
  the old recovery runs instead, so the message is not lost.

## 1.20.3

- **The Telegram menu is thirteen rows, and it is built from the registry.**
  It had thirty-six, written by hand inside `bot-menu.mjs` — a second list next
  to the one `commands-registry.mjs` already kept. That is how `/task` survived
  in the menu for a release after it had become an alias: two lists, one truth,
  and neither knew about the other. `MENU_COMMANDS` now lives beside the
  registry, `bot-menu.mjs` renders it with the `menu.cmd.*` strings, and a test
  fails if a row is an alias, a duplicate, one letter away from another row
  (`task`/`tasks`, `sessions`/`resume`), or written by hand again.
- **Nothing was removed, only unadvertised.** Every command still works and
  `/help <name>` still explains it; the menu is what a person presses, not what
  exists. `/menu` draws the whole surface as sections.
- The menu had also been replaced at some point by the 31-command list of
  `@xmanrui/dsh-im`; the bridge re-asserts its own list on start, and this is the
  list it now asserts.

## 1.20.2

- **`/task` and `/tasks` are one command again, and the menu shows it once.**
  They had been split because `/tasks`, as an alias, swallowed the argument:
  `/tasks 1` added a task whose text was "1". Splitting fixed that and doubled
  the list — two nearly identical names, one of which did nothing the other could
  not. `/tasks` now takes the argument itself: a bare number ticks that task,
  `done|rm|edit <n>` say it out loud, any other text adds, and no argument shows
  the card. `/task` still works and is never advertised, the way `models` and
  `plugin` already work. `ctrl.help.about.task` folded into
  `ctrl.help.about.tasks`; `/help`, the panel, the README and the start guide
  teach one name.

## 1.20.1

- **A voice note now arrives as a transcript, and says so.** The turn used to get
  the recognised words with nothing marking where they came from, so a misheard
  word was read as a deliberate one: "dodge" recognised as "дождь" turned a car
  into weather, and the answer was about the wrong subject. The prompt now opens
  with a line saying the text was produced by speech recognition, that names,
  Latin words and rare terms may be misheard, and that the model should ask what
  was meant instead of guessing. The echo in the chat is unchanged — the person
  still sees what was heard before the reply. `test/voice-marker.test.mjs`.
- **The published package no longer names a provider.** `model-probe.mjs` fell
  back to a hard-coded provider environment variable while its own comment
  promised that nothing was hardcoded; the probe now reads the first provider row
  of the profile, with `DSH_PROBE_BASE_URL` and `DSH_PROBE_KEY_ENV` as the generic
  overrides.

## 1.20.0

- **A turn shows its answer, not its reasoning.** When a turn ended without a
  final answer, the CLI's `final` event reported the last assistant text it had
  — the reasoning — and the bridge sent that as the reply. The chat then held a
  page of thinking with no answer under it. The answer is now compared with the
  reasoning block the panel already holds (whitespace-normalised, and only when
  it is at least 120 characters, so "ok" cannot be swallowed); an echo becomes
  one line saying the turn ended without an answer. `test/reasoning-echo.test.mjs`.
- **Every shipped module fits in one screen.** `bridge.mjs` 3116 → 411 lines,
  `control.mjs` 2734 → 97, each dictionary 2024 → an 8-line header over
  `core.mjs` (214 keys) and `ctrl.mjs` (421). The ceiling is a test, not a
  promise: `test/module-size.test.mjs` fails above 500 lines and its `MIGRATION`
  set — which once carried the files still waiting — is empty, so there is no
  file left to exempt. The moves themselves change no behaviour; the process is
  in `docs/REFACTORING.md` and the archived change is
  `openspec/changes/archive/2026-10-28-split-giant-files/`.
- **The pre-push scanner stopped flagging merged pull requests.** GitHub writes
  its own merge commits as `Committer: GitHub <noreply@github.com>`, and the
  exemption in `scan-secrets.mjs` was written where it could never match, so the
  first merged PR made every later push fail the check. The rule now reads the
  address from its `@` and allows the whole `github.com` domain; a personal
  domain is still a finding, and both cases are tested.

## 1.19.12

- **The speed number added in 1.19.11 was wrong.** The harness reports
  `outputTokens` per step, not for the turn, so dividing the last step by the
  whole clock claimed 0.6 tok/s for a turn that was running at eighty. The panel
  now sums the per-step numbers and divides that, and the test asserts the sum
  rather than the assignment.
- **The bot answers again.** 1.19.11 moved the allowlist check to the very front
  of every update and called `allowedSender(msg)` without the config, so the
  list of allowed users was read from `undefined` and came back empty: every
  message, the owner's own included, was logged as `ignored update` and dropped
  silently. One argument restores it, and the wiring test now asserts
  `allowedSender(msg, config)` rather than a bare call name, which is exactly
  how the regression got through.

## 1.19.11

- **The turn panel shows how fast it is generating**, in tokens per second, next
  to the clock: `⏳ работаю… 412 с · 37 т/с`. The clock alone could not answer
  "почему так долго" — a slow provider and a turn that spends its minutes in a
  test run look identical. The number is the turn's average, output tokens over
  wall time, and it is absent below three seconds rather than wrong.
- **A steer is confirmed the moment it is queued.** It used to produce nothing
  at all: the `steer-inbox` plugin hands the addition to the running agent at its
  next step, and a step can be a six-minute test run, so the addition looked
  lost. There is now one short line at queue time; the 90-second notice is kept
  for a job the plugin really has not picked up.

## 1.19.10

- **A command typed in the General topic no longer changes another topic.**
  General ("Все") is the lobby: a message written there is moved into the most
  recently active topic so one project stays in one place, and the answer appears
  there. That is right for a prompt and for reading — but `/new` typed in General
  wiped the session of a topic the person was not looking at, and `/rewind` rolled
  one back. Reading commands and `/stop` still follow the work; everything that
  changes state is answered in General with the name of the topic it would have
  changed. A command never creates a topic.

## 1.19.9

- **`/tasks` is a command of its own again.** It had been an alias of `/task`,
  which made the tappable checklist — the thing the README advertises —
  unreachable, and made `/tasks 1`, the obvious way to mean "task 1", add a task
  whose text was "1". The card also refused to draw for goals with fewer than
  three tasks, which is most goals.
- **`/plugin add` installs into the topic's profile.** It wrote to the literal
  `desktop` whatever profile the topic ran on, so on a fresh machine the only
  in-chat install landed in a profile that does not exist. The `headless` /
  `desktop` word is now read at either end of the line, as the help text always
  said.
- **`setup` refuses on macOS and Linux instead of failing obscurely.** It stops
  the old bridge with `taskkill` and registers autostart through `schtasks`, yet
  the README promised "any platform" and `launchd`/`systemd` from that command.
  It now names `install.sh` and exits 2; `--check` still runs everywhere.
- **`init` calls a missing headless profile a blocker**, because with no profile
  the bot answers every message with an error. It names the one command that
  fixes it.

## 1.19.8

- **Fixed: sync-runtime copied only the root .mjs files, so the dictionary
  split in 1.19.7 left the runtime directory with an import that could not
  resolve — the bridge would refuse to start after the next /restart confirm.**
  It now copies exactly what package.json says the package is made of,
  including subdirectories, and test/sync-runtime.test.mjs runs the real script
  into a temp directory and boots the result. Caught minutes after publishing
  1.19.7, before anyone restarted into it.

## 1.19.7

- **Fixed: three files promised Node 20 (and one promised 18) while the package
  requires 24.** `install.sh`, `install.ps1`, `QUICKSTART.md` and the sanity check
  inside `setup.mjs` each had their own idea of the floor, so a person on Node 22
  passed every check and then died on the first session read — the failure looked
  like a broken plugin, not a version requirement. All four now say 24, and
  `test/node-floor.test.mjs` fails the build if any of them drifts again.
- **Changed: the dictionary is one file per locale.** `i18n.mjs` was 2024 lines
  and every translation change meant scrolling a wall; it is 94 lines plus
  `i18n/{en,ru,zh}.mjs` at ~640 each. No behaviour change — the existing parity
  test compares the three tables key by key, and `sync-runtime` learned to create
  the directory a nested `files[]` entry needs.
- **New: `docs/REFACTORING.md`.** The order in which the two remaining big modules
  get split, what breaks during a move, and the rule that a refactor never shares
  a commit — or a release — with a behaviour change.

## 1.19.6

- **Security: a stranger the bot can see could steer the owner's live turn.**
  `allowedUserIds` was checked inside `handleMessage`, but the mid-turn addition
  path (`steerRunningTurn`) runs one step earlier in the update loop and never
  reaches that check — so any Telegram user who could message the bot could put
  text inside a turn that already has shell and file tools. The allowlist is now
  the first thing every update meets, in `accept`, before any branch; the rule
  lives in `allowlist.mjs` so it can be tested without booting the bot.
- **Fixed: `/update confirm` never worked, for anyone.** It read
  `<tmp>/package`, a layout npm stopped producing years before this project
  existed (the package goes to `node_modules/`), and copied every entry with
  `copyFileSync`, which throws on the first directory (`plugin/`, `skills/`).
  The copy is now `cpSync` over the real path, split into `copyRelease()` so the
  two faults are covered by tests instead of by hope.
- **Fixed: a missing DSH app killed the bridge on every turn, silently.**
  `runTurn` spawned the desktop executable with no `error` listener; an
  unhandled `EmitError` terminates the process, so a moved install looked like a
  bot that answers nothing. The turn now fails with one line naming the exact
  path and the config key that points elsewhere.
- **Fixed: `/task` and `/goal` printed the same card.** `/goal` is the plan
  (objective, checklist, progress) and `/task` is the list you tick — it now
  answers with the numbered checklist only, so typing either one tells you which
  command owns what.

## 1.19.5

- **New: `/logs file` test no longer needs a machine that has run the bridge.**
  The test stat'ed the real `bridge.log`; on a laptop it exists, so the branch
  that answers when it does not was never exercised. It writes its own log into
  the sandbox home now.
- **Fixed: `/thoughts` promised a disappearing message and sent a permanent one.**
  The title said the block would be gone in a few minutes while the send was an
  ordinary reply — the one thing a person cannot check until they scroll back a
  day later. The report now goes through the bridge's self-deleting send, the
  promise names the interval (three minutes), and a test asserts the block never
  leaves as a permanent message.
- **Fixed: CI was red for the whole 1.19.x line.** Two faults, both invisible on a
  developer machine: the Node 20 leg died on the zstd import, and one test matched
  a whole statement against `\n` only, which a Windows checkout turns into CRLF.
  Both are fixed and the suite runs green on the real matrix.

## 1.19.4

- **Fixed: the package claimed Node 20 and died on it.** Every command that touches
  a session reads zstd frames, and `node:zlib` only grew the zstd codec in Node 24 —
  the version DeepSeek Harness ships in its own runtime. The suite went red on the
  Node 20 leg of CI for a month of releases, which nobody saw because the badge was
  not part of the release gate. `engines.node` now says `>=24`, CI runs 24, and a
  test fails the build if the declared floor and the CI matrix ever drift apart
  again.
- **Fixed: the failure is now readable.** Importing a missing export is a syntax
  error thrown before any code runs, so an old Node got
  `does not provide an export named 'zstdDecompressSync'` and nothing else. The
  zstd import is guarded: the message names the requirement.
- **Fixed: a test only passed on one line ending.** `cli-sync` matched
  `const RUNTIME_FILES = ...;\n`, which is false on a Windows checkout that hands
  the test CRLF — so the test was green locally and red in CI. It matches either
  ending now.

## 1.19.3

- **New: `/plugins info <name>` — what a package is before it gets in.** The card
  shows the version, what the package does, its licence, its repository, and the
  line that decides the outcome: whether the manifest declares `dsh.bundle`. A
  package that does not declare it is an ordinary npm package and DSH will not
  load it — the chat now says that instead of installing it hopefully.
- **New: `/plugins update` — a report first, installs one at a time.** A wordless
  call compares every installed bundle with the registry and answers with a list
  plus one up-arrow button per package; the button runs
  `/plugins update <name>`, which is the only thing that starts pnpm. Saying one
  word must not start twenty installs.
- **Fixed: a closed goal stayed closed only until someone fixed a typo.**
  `/goal <text>` reset the `done` flag, so editing the wording silently reopened
  the work. The mark now survives a re-wording, the card says the goal is still
  closed, and `/goal reopen` is the explicit way back.
- **Fixed: the plugin tests could install into the desktop profile.** One test
  walked the real profile and ran pnpm for every bundle it found — while this
  release was being prepared it upgraded 14 packages on the development machine.
  Every test that imports `control.mjs` now gets a throwaway `DSH_HOME` from
  `test/sandbox-home.mjs`, and a guard test fails the suite if a new one forgets.

## 1.19.2

- **Fixed: system commands answered a stranger in Russian.** `/restart`,
  `/stop`, `/cd`, `/new`, `/help`, the start greeting and reminders each
  carried their own `|| 'ru'` fallback, so an install whose owner never ran
  `/lang` — and whose config had no default — spoke Russian to everyone, while
  `resolveLang` promised English for an unknown reader. One rule now:
  topic language, then `config.lang`, then English. A topic that chose Russian
  still gets Russian; the difference is only what happens when nobody chose.
- **New: `/task edit <n> <text>` rewrites a checklist line in place.** The
  desktop lets you edit a task; the chat could only delete it and add it again,
  which renumbered every line below and broke whatever the conversation had been
  quoting. An edit keeps the number, the position and the done mark;
  `/task set` is the same action, and an impossible number is refused instead of
  appending a line.
- **Docs: the changelog no longer names anyone's providers.** The published
  changelog recorded the provider accounts and private channels of one install.
  The portability grep used to skip that file, which hid the one place a public
  reader could see them; both are fixed, and the grep now covers every file.
- `package.json` gained the repository's homepage and issue tracker, and npm's
  own `pkg fix` shortened the `bin` path.

## 1.19.1

- **Fixed: a tap in the panel ran an explanation instead of the command.** Every
  command that takes an argument opened its help page, so most of the panel
  answered with a paragraph — the buttons looked like text, not like commands.
  A press now runs the command bare, exactly as typing it would, and the command
  answers with its own usage line or its own card. Only `/new` and `/stop`
  still stop at their explanation: a stray tap must not start a session or kill a
  turn.
- **Fixed: the English progress header was Russian.** `bridge.progress.topic`
  was left in the Russian block's spelling, so an English chat read
  "Тема: main (id 42)" above every tool line. Three new tests now check that each
  dictionary stays in its own language: no Cyrillic in the English or Chinese
  values, and no untranslated English sentence in the Chinese one.
- **The panel leads with what is used daily.** `/menu` opens with four buttons —
  status, model, new session, stop — above the six sections, so the common case
  costs one tap instead of three. Nothing is listed twice.
- **The Telegram command menu no longer advertises aliases.** `/tasks`,
  `/models`, `/plugin` and `/agentset` are still accepted, but they are gone
  from `setMyCommands` (and their two Russian descriptions with them), matching
  what the panel already did.
- **New: `/plugins search <word>` — the marketplace, from the chat.** It asks the
  npm registry for the `dsh-plugin` keyword and answers with name, version and a
  line of description; each result carries a plus button that runs
  `/plugins add <name>`. A wordless search lists what exists at all. A refused
  registry is reported as a failure with its status, never as "nothing found" —
  the two send a person in opposite directions.
- **Fixed: the failure rules live in `failures.mjs`.** Extracting them from
  `bridge.mjs` is what lets `TURN_TIME_CAP` be tested without starting a bot;
  the module is published with the rest.

## 1.19.0

- **Fixed: a turn stopped by its own time ceiling no longer reads as a
  failure.** The bridge's clock reported `turn exceeded 75 min` as an unknown
  error and told the person to repeat the request — which throws away a finished
  hour of work that is, in fact, safely on disk. It is now its own cause,
  `TURN_TIME_CAP`, saying that nothing is lost and that Continue picks up where
  it stopped. The failure rules moved to `failures.mjs` so they can be tested
  without starting a bot.
- **New: `/fork` and `/branches` — branches, as on the desktop.** `/fork`
  copies this topic's session as a session of its own and moves the topic onto
  the copy; `/fork 2` copies it as it stood two turns back. Nothing is cut: the
  session you were in stays byte for byte as it was, and `/branches` lists the
  branches with a button each, so going back is a tap and not a guess. The copy
  gets a new id in its header — a copy that kept the old one would be two
  sessions with one name. Same refusals as `/rewind`: a session being written,
  or one whose tail is half-written, is not copied.
- **New: `/menu` is a real menu — six sections, pages, and a keyboard you can
  keep.** The old panel was one card of sixteen buttons that vanished on the
  first press. It is now a hub and six pages (work, sessions, goals, model,
  extensions, service), each page one card that edits itself as you move, with
  its commands as buttons, a way back and a way onward. Every documented command
  is reachable from it and nothing else is: a test fails if the panel hides one.
- **New: `/menu on` puts four keys under the message field** — status, menu,
  stop, new — and `/menu off` takes them away, remembered per topic. A tap sends
  the key's own word, so the bridge maps those four words back to their commands
  in all three languages; any other word stays a prompt, exactly as before.
- **Fixed: the `/help` body ran two lines together.** `/subscribe on|off` and
  `Other:` were printed as `on|offOther:` in all three languages — a missing
  newline from an earlier edit, which also made the whole body unparseable as a
  single line.
- **The panel no longer advertises old spellings.** Buttons carry the command
  they run (`/model <id>`, `/rewind [n]`), which is also how the panel teaches
  the names — and a test walks every button of every page for a stale name.

## 1.18.0

- **Fixed: "all models are unavailable" gave no reason.** After the probe found
  out *why* nothing answered, the hint was built by gluing the verdict onto a raw
  provider string, and the first thing in the message was the tail of an English
  error (the chat showed `in`, from `insufficient …`). The hint lives in
  `model-probe.mjs` now, is a sentence in the reader's language, and says which of
  four things is wrong: empty balance, overloaded provider, rejected key, dead
  network.
- **Faster: a dead channel pool no longer costs a turn per model.** A
  `get_channel_failed` / `all providers are busy` 503 is the provider's own pool,
  not the model — it is down for every model in the chain. One probe after the
  first refusal now decides in seconds instead of four full turns: a real outage
  that took 741 seconds reports in under two minutes, and a pool that answers
  again lets the chain continue as before.
- **Fixed: a chain that stopped early went silent.** The "all models are
  unavailable" message only fired when every model had been tried, so the new
  early stop would have ended the turn with nothing. A verdict now counts as the
  report, and a test pins the rule: no verdict and a short chain is not proof.

## 1.17.0

- **Fixed: `/rewind` could cut a session the desktop app had open.** The first
  1.16.0 rule only refused while a *bridge* turn was running, but the app keeps a
  write handle on a session it has open, and DSH then throws "stored log shrank
  below a previously observed prefix" at the next message. A session written to
  in the last half minute is now refused with a sentence that says to wait. The
  projection cache needs nothing: rows past the new end are discarded and the
  title is refolded from what remains.
- **Fixed: two refusals were a key name or a sentence that said nothing.** Every
  refusal the planner can return now has words in all three languages, and a test
  holds the planner's own list to the translations, so a new refusal cannot ship
  wordless. Two Chinese messages were rewritten: they were correct but so short
  they did not say what to do.

## 1.16.0

- **New: `/rewind [n]` — go back a turn and say it differently.** The desktop
  app can branch from an earlier turn; the bridge now can too, from Telegram.
  `/rewind 2` shows a card naming every turn that will go and the turn the
  session will continue from, with one button to confirm and one to cancel.
  Nothing is cut until the button is pressed, the file is never edited in place
  (a copy is written first, and `/rewind undo` puts it back), and a turn that is
  running refuses the whole thing — a session being written is the one file this
  must never touch. Every ambiguous case refuses with a reason instead of
  guessing: no session, too few turns, a half-written tail, a button from
  another session, a button pressed twice.
- **New: `/menu` — the panel.** Four short screens of buttons (work, answers,
  session, service). A press runs the command a person would have typed, and the
  card is replaced by that command's answer, so it never lingers. A button that
  needs an argument opens its explanation instead of guessing.
- **New: `/help <command>`.** One sentence per command, and the lookalikes
  explain each other: `/task` adds, `/tasks` is the list; `/model` switches,
  `/models` is the catalogue; `/plugins` is the command, `/plugin` its old
  spelling. The full list is still `/help`.
- **Fixed: two crashes in unreleased work, found by an audit before release.**
  `/help <anything>` and `/rewind` both threw a `ReferenceError` — one on a
  function that was called and never written, one on a variable read outside its
  scope. `node --check` cannot see either. A test now calls the real dispatcher
  with every command and asserts that none of them throws.
- **Fixed: the commit history carried a personal email address.** Two commits,
  one of them reachable from every release since v1.10.0, were authored with the
  maintainer's private address. The whole history was rewritten to the project
  identity and every tag moved with it; nothing in the published package changed.
  The secrets scan now fails on a commit author, not only on file contents.

## 1.15.1

- **Fixed: `/settings` answered "Неизвестная команда".** It was in `/help`, in
  the Telegram menu and in the code that draws the card, but not in the list the
  bot checks before handling a command — the one list nothing compared against
  the other two. Now one test reads all three: a command in help or in the menu
  that the dispatcher does not know fails the build, and so does a command the
  dispatcher knows that nothing documents. The test was run against the broken
  code first, so it fails for the right reason.

## 1.15.0

- **New: `/settings` is one card with four tabs.** What the bot says (reasoning,
  language, thinking), who answers and how hard it works (model, effort,
  permissions, preset, agent set, agents), new releases, and the health checks.
  Each row shows what the value is now and what a tap would change it to, and a
  tap runs the command a person would have typed — the card cannot drift from
  the commands because it is a view of them. After a change it collapses into one
  plain line that can be deleted.
- **Fixed, and it was the worst kind: `/prices` printed a wrong number.** The
  catalog holds the same model on about a hundred gateways, 567 entries at cost 0,
  and the matcher took the shortest substring hit — a free mirror of DeepSeek. The
  install's own model was reported as `$0.0000 / $0.0000`. A price is now chosen
  in a fixed order (published and yours, published, yours at zero, nothing), every
  line says whose price it is, and a route nobody publishes says
  "no public price" and names gateways that do.
- **Fixed: a Chinese question in an English client got an English answer.** The
  reply language now comes from the message itself before the Telegram locale:
  Cyrillic switches the topic to Russian, Han characters to Chinese. Three letters
  minimum, so a model name or a path does not flip it.
- **Fixed: the first command a new reader runs was a 404.** QUICKSTART said
  `npx dsh-tg@latest` eight times; the package is `dsh-tg-bridge`. Every copy-paste
  line now works as written, and the `ERR_MODULE_NOT_FOUND` row says what a global
  install does and does not update.
- **Fixed: `/status` said the context window was unknown.** It looked for
  `contextWindow` in the wrong block of `cordis.patch.yml`, and the advice it gave
  pointed at a file that never holds the setting. It now reads the model's row,
  then the provider's default, and says which one is in force.
- **Fixed: every progress card was one more message in a chat that is already
  busy.** One card per turn, edited in place, now carrying the topic it belongs to
  — a card that lands in the wrong place says so instead of raising the question.
- **`/agents` explains itself.** Who a subagent is, what depth and the tool filter
  change, whose model list the "routes" are, and the one command for each. The
  numbers are still there; the sentence above them is new.
- **The release notice goes to the last topic that ran a turn**, not to whichever
  topic happened to be open when the check ran.
- `scan-secrets` reads commit identities too (`--all`): an address in an
  `Author:` line is personal data that no file in the tree shows, and it used to
  pass every check. Docs corrected where they described behaviour that had
  changed: `/logs file`, `/profile` in `/help`, the module count in the release
  criteria, the menu-language fallback.

## 1.14.0

- **New: updates have a policy.** The npm tag `latest` is a label, not an
  updater — installing pins a version on disk and nothing moves until something
  moves it. Now `/update` answers where the install stands, and takes a mode:
  `check` (the default: one message per new release), `auto` (the release installs
  by itself), `off` (no checks, nothing installs), and `confirm` (install now).
  The mode is per install, not per topic, because it is the install that updates.
- In every mode the running process keeps its modules until `/restart confirm`,
  so a bad release never arrives in the middle of a chat. `confirm` and `auto`
  leave the replaced files in `update-backup-<date>`, and `/update` prints that
  path: one folder is the way back.
- `/update off` pins the version it runs; `/update auto` refuses to be switched on
  top of a pending update, since that would mean two updates at once, one of them
  unattended.
- `/subscribe on|off` is the same switch said plainly, for people who do not want
  to read `/update` first. It is not in the Telegram menu: a person who turned it
  off should not have to look for it there again.
- The check rides the poll loop's idle and asks npm at most once a day (`check`)
  or once an hour (`auto`). The first check runs three minutes after a start so a
  restarting machine does not hit the registry on every boot.
- Docs brought back in line with the code: `/models`, `/plugin`, `/tasks`,
  `/subscribe` and the whole `Sets:` and `Updates:` groups are in the README, in
  `/help` in all three languages, and in the Telegram menu; `/models` and
  `/plugin` were missing from the menu entirely.

## 1.13.2

- `QUICKSTART.md`: from no Telegram account to an answering bot in twelve steps,
  with a table of what actually goes wrong and what each symptom means. It ships
  in the package and is linked from the top of the README.
- `skills/dsh-tg-bridge-onboarding/SKILL.md`: the same path as a skill, so an
  agent next to a newcomer can ask three questions, run the install and verify it
  by asking the person to send `hi` — not by reading logs.

## 1.13.1

- **Fix: the npm package could not start.** `format.mjs` was imported by
  `bridge.mjs` but missing from `files[]`, so `npm i -g dsh-tg-bridge` installed a
  package whose entry point fails on its first import. The check that would have
  caught it (does every shipped `.mjs` exist and does every relative import
  resolve?) now runs in the test suite.
- `npm run secrets` and `npm run hooks` expose the scanner and the git hook
  installer from a published install.
- Fix: a step note could land in another topic. Two turns running at once shared
  one note file per topic, and `say.mjs` learned the topic by picking the newest
  file on disk. Every turn now gets its own file, its path travels to the tools
  as `DSH_TG_THOUGHT`, and with no target `say.mjs` exits (7) instead of guessing.
- **New: `/tasks` — the task list as buttons.** One tap closes a task, a second
  tap reopens it, and the card is redrawn from state, so a double tap cannot
  stack ✅ marks. The list is in the menu in all three languages.
- Fix: `goal.mjs` took the topic from `--key`, which was easy to forget, so a
  task update could be written to the wrong topic or refused. It now takes
  `DSH_TG_KEY`, which the bridge passes to every turn.
- A turn with no goal is told to set one before starting multi-step work, so the
  plan the person can see and the plan the agent follows are the same list.
- **Security: a local push guard.** `scan-secrets.mjs` refuses tokens, private
  keys, paths that carry a user name and personal ids kept outside the repo;
  `.githooks/pre-commit` and `pre-push` run it, `install-hooks.mjs` installs them.
  `jev-gate` asked a remote model about secrets and only when run by hand, which
  is why an identifier reached a push earlier.

## 1.13.0

- **New: `/agentset` — named settings for a topic.** A set holds a model, an
  effort, a permission preset, a DSH agent preset and a language; every field is
  a delta, so an empty one inherits the profile. `/agentset use <id>` binds it to
  the current topic, `/agentset off` returns to the profile, `/agentset new`,
  `copy`, `rm` and `/agentset model <value> [id]` edit it without a text editor.
  Four builtins ship read-only — `normal`, `careful`, `fast`, `reviewer`; copy one
  to change it. Two topics can now run two models on one profile, which was
  impossible before: each of those switches wrote the shared profile patch.
- Sets live in `agentsets.json` next to `state.json`, with their own revision and
  one silent rebase when two processes write at once, so a set saved by a second
  bridge is not lost by the first.
- The progress message says which set a turn runs on (`On it: … · 9 s ·
  Reviewer · glm-5.3/high`), and nothing when no set is bound.
- **Security: every inline button now checks the allowlist.** A callback used to
  be accepted from any user in any chat the bot was in; the message path was
  guarded, the button path was not. A press from outside `allowedUserIds` (and
  outside an allowed chat) is answered with the same "unknown button" text and
  changes nothing.
- Fix: `agentsets.json` is refused, not overwritten, when it cannot be parsed.

## 1.12.1

- Fix: `bridge.mjs` spelled out one machine's secret name
  (`DSH_TELEGRAM_BOT_TOKEN_<hex>`, a per-install id), so a clone carried the
  original author's machine fingerprint. The suffix is now discovered from
  `~/.dsh/.credentials.yaml` instead of being written into the code.

## 1.12.0

- Fix: a restart went silent. Extracting the formatting helpers into `format.mjs`
  took `langFor` with them while two call sites stayed behind, so `send()` threw
  on its first line and the restart confirmation was logged and swallowed. The
  bridge now sends `✅ Мост поднялся` again after `/restart confirm`.
- Fix: the npm README linked to `docs/*` files that the tarball does not ship, so
  every such link opened a 404 right after install. The links now point at the
  GitHub sources, and the install scripts and SECURITY.md are published too.
- New: `test/bridge-wiring.test.mjs` reads `bridge.mjs` and fails when a called
  name is neither defined nor imported, and checks that every i18n key used by
  the bridge exists in all three languages.

## 1.11.0 — 2026-10-25

- The progress message opens with the request echoed back — `⏳ Принял: «…» · 3 с` — instead
  of a bare spinner. It is the first thing sent after a message arrives, so the person sees
  their own task named within a second, before the model has produced anything.
- `say.mjs --note "…"` sends a real short chat message, for decisions that change what the
  person should expect: a release shipped, a cause found, a blocker. `--thought` stays the
  decision trail inside the panel, so the chat does not get one message per step.
- The per-turn instruction now names both channels: 💭 for every significant step, `--note`
  only for what must be known now.
- Two more panel tests (122 total).

## 1.10.1 — 2026-10-25

- Long answers no longer arrive as literal `<b>` and `<code>`. The reply was turned
  into Telegram HTML first and then cut at 3800 characters, so a cut inside a
  `<pre><code>` block invalidated every part; Telegram rejected them and the fallback
  resent the same markup as plain text — which is what the chat showed.
- The reply is now split as markdown: never inside a fence, with the fence re-opened
  and its language tag kept, and each part converted on its own.
- The plain fallback strips tags and entities, so even a rejected formatted message
  arrives as readable text instead of markup.
- `format.mjs` holds the conversion and the splitting, with seven tests that pin the
  old failure (120 in total).

## 1.10.0 — 2026-10-25

- `/thoughts file` sends the **whole** reasoning of the last turn as a Markdown
  document (`reasoning-<date>-file.md`), and `/thoughts all` does the same for every
  turn of the session. Measured on a real session: the last turn was 15 steps /
  30 317 characters, the whole session 164 turns / 1 559 steps / 2.2 MB — fine for a
  document, impossible for a message.
- `/thoughts off` keeps the reasoning block out of the turn panel: it shows
  `🧠 Размышления · N · /thoughts file` instead, and `/thoughts on` brings the block
  back. The switch is per topic and lives in `state.json`.
- A cut block now points at `/thoughts file`, and the plain `/thoughts` reply ends
  with the hint that lists the three modes.
- Logs are built from the session file on demand and pruned after a week.

## 1.9.3 — 2026-10-25

- Reading a block no longer gets interrupted. Telegram re-collapses an expanded
  `<blockquote>` on every edit of its message, so tapping the reasoning open and
  then the next 3.5 s edit landed the chat back on an older message. Blocks now
  appear only in the final edit of a turn, which nothing edits again; while the
  turn runs the panel shows a reasoning counter (`🧠 Размышления · 4821`) and the
  last three steps. Edits are also skipped when the text did not change and the
  cadence dropped from 3.5 s to 5 s.

## 1.9.2 — 2026-10-25

- Step lines name the work instead of the shell plumbing: the `cd <dir>` prefix and
  the shell wrapper are dropped and the arguments kept, so a row reads
  `pwsh: node sync-runtime.mjs` rather than `pwsh: node`. A call that only changed
  directory is not a step at all, and repeats fold into the line above as `×3`.
  A 35-row wall of `pwsh: cd` is now six rows of what actually ran.
- A cut reasoning block says where the rest is (`… · /thoughts`) instead of starting
  mid-sentence with no explanation.
- `/thoughts` sends the whole reasoning of the last turn in parts (up to 20k
  characters) rather than stopping at 4000 with an ellipsis.

## 1.9.1 — 2026-10-25

- `/remind list` lists the reminders instead of failing as an unreadable time, and
  the hint line mentions it.
- `/help` shows the real `/agents set model|depth|filter … @tool` form, which was
  still documented as `/agents <id>`.

## 1.9.0 — 2026-10-25

- The turn message shows the whole turn: the reasoning block plus, when a turn
  makes more than three tool calls, the complete step list in a second collapsed
  block. Short turns keep their three inline steps; long ones no longer end at
  "…and 37 more" with no way to see them.
- Both blocks are budgeted against Telegram's 4096-character limit (reasoning
  2000, steps 1600, panel 3900) and keep their tails with a "beginning hidden"
  note, so the newest part of the turn is always the part on screen.

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

- `/prices` no longer assumes one provider: it merges the provider catalog and
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
- Extra providers added to the headless profile; keys live in
  `.credentials.yaml` and are passed to the CLI child environment.
  Subagents run on a cheaper model than the topic.
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
