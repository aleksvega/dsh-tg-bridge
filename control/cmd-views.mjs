// The reading cards: what this session is, which model answers, and how it answers.
//
// One group of the `/` surface. `control.mjs` owns the dispatch and this file
// owns the commands, so a change to `/agents` no longer touches `/update`.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, LANGS, normalizeLang } from '../i18n.mjs';
import { addTask, clearGoal, doneTask, editTask, finishGoal, goalOf, progressOf, reopenGoal, removeTask, setGoal } from '../goals.mjs';
import { lastTurnReasoning, lastTurnReasoningSteps, lastTurnText, reasoningMarkdown, sessionFile, sessionReasoningSteps, sessionStats } from '../thoughts.mjs';
import { parseAgentPresets, parseModelSelection, parsePermissionPresets, parseReasoningEfforts, parseSubagentFleet, parseSubagentRows } from '../agents.mjs';
import { setRowConfig, unsetRowConfig } from '../profile-edit.mjs';
import { parseReminder, stampAt, upcoming } from '../reminders.mjs';
import { AgentsetStore, emptySet, slugId } from '../agentsets.mjs';
import { SETTINGS_PAGES, renderSettingsCard, settingsCurrent } from '../settings-card.mjs';
import { applyFork, planFork, planRewind } from '../rewind.mjs';
import { cutSession, isRewindPress } from '../rewind-buttons.mjs';
import { renderRewindCard, renderRewindUsage } from '../rewind-card.mjs';
import { MENU_GROUPS, commandForName, renderPanel, replyKeyboard } from '../menu-card.mjs';
import { explainCommand } from '../help-explain.mjs';
import { profileValues, resolveSettings } from '../settings.mjs';
import { UPDATE_DEFAULTS, describeUpdate, modeChange, updateState } from '../update-policy.mjs';
import { isNewer, pluginInfo, rowLine, searchPlugins } from '../plugin-search.mjs';
import { COMMAND_ALIASES, CONTROL_COMMANDS, DOCUMENTED_COMMANDS } from '../commands-registry.mjs';
import { APP, CLI_JS, DSH_CMD, DSH_HOME, EXE, HOME, PROFILES, THOUGHT_DIR } from '../paths.mjs';
import { read, readJson, patchPath, pkgPath, OVERLAY_MARK, modelsOf, modelOf, windowOf, modelIndent, depthOf, modelsReport, setModel, disabledIds, setDisabled, writePatch } from './models.mjs';
import { listPids, waitForExit, waitForStart, pluginsOf, bundleRowIds, addBundle, removeBundle, createProfile, dshPlugin } from './plugins.mjs';
import { cwdSlug, bareId, stamp, recentSessions, sessionTitle } from './sessions.mjs';
import { agentsOf, fleetOf, patchRows, skillsOf, AGENTS, PERSONA_HEADING, soulOf, setSoul } from './agents.mjs';
import { fmt, AGENTSETS, agentset, agentsetOf, profileRowOf, bindAgentset, agentsetCard, agentsetKeyboard } from './agentsets.mjs';
import { taskKeyboard, goalView, taskView, reasoningOf, filterLogLines } from './tasks.mjs';
import { reasoningMode } from '../notes.mjs';
import { updatePolicy, bridgeRoot, copyRelease, installRelease, bridgeVersion, newestModuleMtime, npmLatest, npmLatestAsync } from './release.mjs';
import { presetOf } from '../profile-view.mjs';

export async function handleViewCommands(ctx) {
  const { command, arg, send, reply, log, profile, state, key, config, lang: rawLang } = ctx;
  // The topic's language, then the config default, then English. Never Russian:
  // a group that has no opinion still must not guess a language.
  const lang = normalizeLang(rawLang) || normalizeLang(config?.lang) || 'en';
  const say = (text, extra) => (extra ? reply(text, extra) : reply(text));
  const activeProfile = profile || config.profile || 'headless';
  const effective = ctx.effective || command;
  switch (effective) {
    case '/status': {
      const head = modelOf(activeProfile);
      const active = ctx.activeTurns ? ctx.activeTurns.size : 0;
      // A card, not a key dump: the identity first, then what the session is
      // doing, then the environment. Numbers are the ones a person asks for
      // ("how much context is left", "how big is this session").
      const sessionId = state.sessions[key] || '';
      const stats = sessionId ? sessionStats(sessionFile(join(DSH_HOME, 'sessions'), sessionId)) : null;
      const title = sessionId ? (state.titles?.[key] || sessionTitle(sessionId)) : '';
      const lines = [t(lang, 'ctrl.status.head')];
      lines.push(t(lang, 'ctrl.status.session', { id: sessionId || t(lang, 'ctrl.session.none') }));
      if (title) lines.push(t(lang, 'ctrl.status.title', { title }));
      lines.push(t(lang, 'ctrl.status.profile', { name: activeProfile, route: `${head.provider}/${head.model}` }));
      lines.push(t(lang, 'ctrl.status.thread', { name: ctx.threadId || t(lang, 'ctrl.status.threadDefault') }));
      if (stats?.createdAt) lines.push(t(lang, 'ctrl.status.created', { when: stamp(stats.createdAt) }));
      if (stats?.lastActivity) lines.push(t(lang, 'ctrl.status.activity', { when: stamp(stats.lastActivity) }));
      if (stats?.contextTokens) {
        // The window belongs to the profile that answered, not to this bridge's
        // config: read it where the harness reads it, and say "unknown" only when
        // the profile really does not declare one.
        const window = windowOf(activeProfile, stats.model || head.model);
        lines.push(window
          ? t(lang, 'ctrl.status.context', {
            now: stats.contextTokens.toLocaleString('en-US'),
            max: window.toLocaleString('en-US'),
            pct: Math.round((stats.contextTokens / window) * 100),
          })
          : t(lang, 'ctrl.status.contextNoWindow', { now: stats.contextTokens.toLocaleString('en-US') }));
      }
      if (stats?.lifetimeTokens) {
        lines.push(t(lang, 'ctrl.status.lifetime', { n: stats.lifetimeTokens.toLocaleString('en-US') }));
      }
      if (stats?.turns) lines.push(t(lang, 'ctrl.status.steps', { n: stats.turns }));
      lines.push(t(lang, 'ctrl.status.turns', {
        n: active,
        state: active > 0 ? t(lang, 'ctrl.status.running') : t(lang, 'ctrl.status.idle'),
      }));
      lines.push(t(lang, 'ctrl.status.notes', {
        state: t(lang, `msg.reasoningMode.${reasoningMode(state, config, key)}`),
      }));
      lines.push(t(lang, 'ctrl.status.skills', { n: skillsOf().length }));
      // The desktop profile only matters when this install actually has one.
      if (existsSync(join(PROFILES, 'desktop', 'cordis.patch.yml'))) {
        const desk = modelOf('desktop');
        const deskPlugins = pluginsOf('desktop');
        lines.push(t(lang, 'ctrl.status.ui', {
          route: `${desk.provider}/${desk.model}`,
          n: deskPlugins.bundles.length,
        }));
      }
      const currentGoal = goalOf(state, key);
      if (currentGoal) {
        const { done, total } = progressOf(currentGoal);
        lines.push(t(lang, 'status.goal', {
          done, total, text: currentGoal.text.length > 60 ? `${currentGoal.text.slice(0, 59)}…` : currentGoal.text,
        }));
      }
      lines.push(`DSH_HOME: ${DSH_HOME}`);
      say(lines.join('\n'));
      return true;
    }
    case '/models': {
      say(modelsReport(lang, activeProfile));
      return true;
    }
    case '/model': {
      const [wanted = '', scope = ''] = (arg || '').split(/\s+/);
      if (!wanted) {
        // One command, two states: bare `/model` lists what can be picked, and
        // `/model <id>` picks it. A separate `/models` read as a second, near
        // identical command (and did the same thing as `/model` with no id).
        say(modelsReport(lang, activeProfile));
        return true;
      }
      if (!setModel(activeProfile, wanted)) {
        say(t(lang, 'ctrl.model.failed', { name: activeProfile, model: wanted }));
        return true;
      }
      const desktop = scope === 'both' ? setModel('desktop', wanted) : false;
      say(t(lang, 'ctrl.model.switched', {
        name: activeProfile,
        model: wanted,
        desktop: desktop ? t(lang, 'ctrl.model.withDesktop', { model: wanted }) : '',
      }));
      return true;
    }
    case '/profile': {
      // The GUI lets a person build a profile per kind of work; the same switch
      // belongs here, per topic. A new profile is a copy of a shipped template,
      // dependencies are installed on its first turn.
      const [action = '', verb = '', template = ''] = String(arg || '').trim().split(/\s+/).filter(Boolean);
      const profiles = readdirSync(PROFILES, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(PROFILES, entry.name, 'cordis.patch.yml')))
        // Overlay profiles are generated per model (photo turns and fallbacks)
        // and carry a marker row; they are an implementation detail, not a
        // place a person switches a topic to.
        .filter((entry) => !read(join(PROFILES, entry.name, 'cordis.patch.yml')).includes(OVERLAY_MARK))
        .map((entry) => entry.name)
        .sort();
      const bound = state.profiles?.[key];

      if (!action) {
        const name = bound ? activeProfile : `${activeProfile}${t(lang, 'profile.default')}`;
        say([
          t(lang, 'profile.current', { name }),
          t(lang, 'profile.available', { list: profiles.join(', ') }),
          t(lang, 'profile.hint'),
        ].join('\n'));
        return true;
      }

      if (action === 'show') {
        // One card per profile: what it runs, what it carries, who may delegate.
        // `/profile` alone answers "which one am I on"; this answers "should I
        // switch to it", which is the question a person asks next.
        const name = verb || bound || activeProfile;
        if (!profiles.includes(name)) {
          say(t(lang, 'profile.unknown', { name, list: profiles.join(', ') }));
          return true;
        }
        const pkg = pluginsOf(name);
        const route = modelOf(name);
        const { rows, selection } = agentsOf(name);
        say([
          t(lang, 'ctrl.profile.title', { name }),
          t(lang, 'ctrl.profile.model', { route: `${route.provider}/${route.model}` }),
          t(lang, 'ctrl.profile.plugins', { n: patchRows(name), off: pkg.disabled.length }),
          t(lang, 'ctrl.profile.bundles', { n: pkg.bundles.length }),
          t(lang, 'ctrl.profile.agents', { n: rows.length, routes: selection ? selection.allowed.length : 0 }),
          t(lang, 'ctrl.profile.file', { path: join(PROFILES, name, 'cordis.patch.yml') }),
        ].join('\n'));
        return true;
      }

      if (action === 'new') {
        const from = template || 'headless';
        if (!verb || !/^[a-z0-9][a-z0-9-]{1,30}$/.test(verb)) {
          say(t(lang, 'profile.badName'));
          return true;
        }
        if (!profiles.includes(from)) {
          say(t(lang, 'profile.unknownTemplate', { name: from, list: profiles.join(', ') }));
          return true;
        }
        if (profiles.includes(verb)) {
          say(t(lang, 'profile.exists', { name: verb }));
          return true;
        }
        if (!(await createProfile(verb, from))) {
          say(t(lang, 'profile.createFailed', { name: verb }));
          return true;
        }
        state.profiles = state.profiles || {};
        state.profiles[key] = verb;
        ctx.saveState();
        say(t(lang, 'profile.created', { name: verb, template: from }));
        return true;
      }

      if (action === 'default') {
        if (state.profiles) delete state.profiles[key];
        ctx.saveState();
        say(t(lang, 'profile.set', { name: config.profile || 'headless', route: 'install default' }));
        return true;
      }

      if (!profiles.includes(action)) {
        say(t(lang, 'profile.unknown', { name: action, list: profiles.join(', ') }));
        return true;
      }
      state.profiles = state.profiles || {};
      state.profiles[key] = action;
      ctx.saveState();
      const head = modelOf(action);
      say(t(lang, 'profile.set', { name: action, route: `${head.provider}/${head.model}` }));
      return true;
    }
    case '/settings': {
      // The same switches, drawn: one card, four tabs, every button equal to the
      // command a person would type. A button press carries `m:<row>[:<value>]`
      // and `bridge.mjs` answers it by rendering the same card again — the card
      // is a view of the commands, never a second implementation of them.
      const page = String(arg || '').trim().split(/\s+/)[0].toLowerCase();
      if (page && !SETTINGS_PAGES.includes(page)) {
        say(t(lang, 'ctrl.settings.usage'));
        return true;
      }
      // The preset the topic actually starts in comes from the profile it boots,
      // which for a bound topic is a derived copy — not the install's profile.
      let permission = null;
      try {
        permission = presetOf(key);
      } catch {
        permission = null;
      }
      const current = {
        ...settingsCurrent({ config, state, key, reasoningOf }),
        permissions: permission ? { profile: permission.profile, preset: permission.preset?.id || '' } : null,
      };
      const bound = agentsetOf(state, key);
      const card = renderSettingsCard({
        page: SETTINGS_PAGES.includes(page) ? page : 'reply',
        t: (k, vars) => t(lang, k, vars),
        current,
        updateMode: updatePolicy(state).mode,
        bound,
      });
      say(card.text, { keyboard: card.keyboard });
      return true;
    }
    case '/lang': {
      const wanted = normalizeLang((arg || '').trim());
      if (!wanted) {
        say(t(lang, 'ctrl.lang.state', {
          lang: state.lang?.[key] || config.lang || t(lang, 'ctrl.lang.auto'),
          list: LANGS.join(', '),
        }));
        return true;
      }
      state.lang = state.lang || {};
      state.lang[key] = wanted;
      ctx.saveState();
      say(t(wanted, 'msg.langSet'));
      return true;
    }
    case '/reasoning': {
      // One switch for "how much of the decision trail reaches me": off, the
      // progress card, or the chat itself. Anything else prints the current
      // state, so a bare /reasoning never guesses.
      const wanted = String(arg || '').trim().toLowerCase();
      const mode = reasoningMode(state, config, key);
      const next = { on: 'card', card: 'card', chat: 'chat', off: 'off' }[wanted];
      if (!next) {
        say(t(lang, 'msg.reasoningState', { state: t(lang, `msg.reasoningMode.${mode}`) }));
        return true;
      }
      state.reasoning = state.reasoning || {};
      // `on` is the old spelling of the card and stays accepted: it is the word
      // the previous release printed, and a chat is full of those instructions.
      state.reasoning[key] = next;
      ctx.saveState();
      say(t(lang, next === 'off' ? 'msg.reasoningOff' : next === 'chat' ? 'msg.reasoningChat' : 'msg.reasoningOn'));
      return true;
    }
    case '/thoughts': {
      // The model's reasoning, read from the session log. Text by default (short,
      // ephemeral, deletes itself); `file` and `all` write a Markdown log and send
      // it as a document, because a five-hour turn is megabytes of text that no
      // chat message can hold; `off` keeps the block out of the panel entirely.
      const mode = String(arg || '').trim().toLowerCase();

      if (mode === 'off' || mode === 'on') {
        state.thinkBlock = state.thinkBlock || {};
        if (mode === 'off') state.thinkBlock[key] = 'counter';
        else delete state.thinkBlock[key];
        ctx.saveState?.();
        say(t(lang, mode === 'off' ? 'ctrl.thoughts.off' : 'ctrl.thoughts.on'));
        return true;
      }

      const sessionId = ctx.state.sessions?.[key];
      if (!sessionId) {
        say(t(lang, 'ctrl.thoughts.noSession'));
        return true;
      }
      const file = sessionFile(join(DSH_HOME, 'sessions'), sessionId);

      if (mode === 'file' || mode === 'all') {
        const turns = mode === 'all'
          ? sessionReasoningSteps(file).map((turn, index) => ({ title: t(lang, 'ctrl.thoughts.turn', { n: index + 1 }), steps: turn.steps }))
          : [{ steps: lastTurnReasoningSteps(file) }];
        const steps = turns.reduce((sum, turn) => sum + turn.steps.length, 0);
        const chars = turns.reduce((sum, turn) => sum + turn.steps.reduce((n, step) => n + step.length, 0), 0);
        if (!steps) {
          say(t(lang, 'ctrl.thoughts.none'));
          return true;
        }
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const stamp = date.replace(/[ :]/g, '-');
        const path = join(THOUGHT_DIR, `reasoning-${stamp}-${mode}.md`);
        try {
          mkdirSync(THOUGHT_DIR, { recursive: true });
          writeFileSync(path, reasoningMarkdown({
            title: t(lang, mode === 'all' ? 'ctrl.thoughts.fileTitleAll' : 'ctrl.thoughts.fileTitleLast'),
            meta: [date, t(lang, 'ctrl.thoughts.fileMeta', { steps, chars, turns: turns.length })],
            stepTitle: t(lang, 'ctrl.thoughts.step'),
            turns,
          }), 'utf8');
          // A log is a keepsake, not an archive: a week is plenty and the dir
          // does not grow without bound.
          for (const name of readdirSync(THOUGHT_DIR)) {
            if (!name.startsWith('reasoning-')) continue;
            const old = join(THOUGHT_DIR, name);
            try {
              if (Date.now() - statSync(old).mtimeMs > 7 * 86400000) rmSync(old, { force: true });
            } catch {}
          }
          if (ctx.sendFile) {
            await ctx.sendFile(path, t(lang, 'ctrl.thoughts.fileCaption', { chars, steps }));
            return true;
          }
          // No file transport in this context (tests): the log still leaves as text.
          say(`${t(lang, 'ctrl.thoughts.fileCaption', { chars, steps })}\n\n${readFileSync(path, 'utf8').slice(0, 3200)}`);
          return true;
        } catch (error) {
          say(t(lang, 'ctrl.thoughts.fileError', { error: String(error.message).slice(0, 120) }));
          return true;
        }
      }

      const brief = ctx.ephemeral || ((out) => say(out));
      const text = file ? lastTurnReasoning(file, { maxChars: 20000 }) : '';
      if (!text) {
        // Not every turn plans: a one-word answer has no reasoning part at all.
        // Saying "here is what the last turn answered" beats a dead end that
        // looks like a broken command.
        const answered = file ? lastTurnText(file, { maxChars: 1200 }) : '';
        brief(answered
          ? `${t(lang, 'ctrl.thoughts.none')}\n\n${t(lang, 'ctrl.thoughts.lastAnswer')}\n\n${answered}\n\n${t(lang, 'ctrl.thoughts.hint')}`
          : `${t(lang, 'ctrl.thoughts.none')}\n\n${t(lang, 'ctrl.thoughts.hint')}`);
        return true;
      }
      // A message caps at 4096 characters; a long plan goes out in parts instead
      // of being cut at the first one with a "…" that hides the rest.
      const title = t(lang, 'ctrl.thoughts.title', { chars: text.length });
      const parts = [];
      for (let at = 0; at < text.length; at += 3600) parts.push(text.slice(at, at + 3600));
      parts.forEach((part, index) => {
        const last = index === parts.length - 1;
        const head = parts.length > 1 ? `${title} (${index + 1}/${parts.length})` : title;
        brief(`${head}\n\n${part}${last ? `\n\n${t(lang, 'ctrl.thoughts.hint')}` : ''}`);
      });
      return true;
    }
    case '/prices': {
      if (!ctx.prices) {
        say(t(lang, 'ctrl.prices.unsupported'));
        return true;
      }
      try {
        const text = await ctx.prices(arg);
        say(text);
      } catch (error) {
        say(t(lang, 'ctrl.prices.failed', { err: error.message }));
      }
      return true;
    }
    case '/help': {
      // One translated body keeps the help in step with the menu; the Russian
      // text stays as the fallback when a key is missing.
      const helpLang = lang;
      // `/help <command>` answers about one command: the list alone forced a
      // reader to guess which of /task and /tasks they wanted, and the pairs
      // that look alike are exactly the ones worth a sentence each.
      const about = String(arg || '').trim().toLowerCase().replace(/^\//, '');
      if (about) {
        const lines = explainCommand(about, helpLang, t);
        if (lines) {
          say(lines);
          return true;
        }
        say(t(helpLang, 'ctrl.help.unknown', { name: about }));
        return true;
      }
      say(t(helpLang, 'help.body'));
      return true;
    }
    default:
      return false;
  }
}
