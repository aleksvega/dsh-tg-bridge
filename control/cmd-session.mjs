// Sessions and where they live: new, resume, rewind, fork, branches, and the menu.
//
// One group of the `/` surface. `control.mjs` owns the dispatch and this file
// owns the commands, so a change to `/agents` no longer touches `/update`.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, LANGS, normalizeLang } from '../core/i18n.mjs';
import { addTask, clearGoal, doneTask, editTask, finishGoal, goalOf, progressOf, reopenGoal, removeTask, setGoal } from '../work/goals.mjs';
import { lastTurnReasoning, lastTurnReasoningSteps, lastTurnText, reasoningMarkdown, sessionFile, sessionReasoningSteps, sessionStats } from '../chat/thoughts.mjs';
import { parseAgentPresets, parseModelSelection, parsePermissionPresets, parseReasoningEfforts, parseSubagentFleet, parseSubagentRows } from '../profile/agents.mjs';
import { setRowConfig, unsetRowConfig } from '../profile/profile-edit.mjs';
import { parseReminder, stampAt, upcoming } from '../work/reminders.mjs';
import { AgentsetStore, emptySet, slugId } from '../profile/agentsets.mjs';
import { SETTINGS_PAGES, renderSettingsCard, settingsCurrent } from '../profile/settings-card.mjs';
import { applyFork, planFork, planRewind } from '../work/rewind.mjs';
import { cutSession, isRewindPress } from '../work/rewind-buttons.mjs';
import { renderRewindCard, renderRewindUsage } from '../work/rewind-card.mjs';
import { MENU_GROUPS, commandForName, renderPanel, replyKeyboard } from '../chat/menu-card.mjs';
import { explainCommand } from '../chat/help-explain.mjs';
import { profileValues, resolveSettings } from '../profile/settings.mjs';
import { UPDATE_DEFAULTS, describeUpdate, modeChange, updateState } from '../core/update-policy.mjs';
import { isNewer, pluginInfo, rowLine, searchPlugins } from '../chat/plugin-search.mjs';
import { COMMAND_ALIASES, CONTROL_COMMANDS, DOCUMENTED_COMMANDS } from '../chat/commands-registry.mjs';
import { APP, CLI_JS, DSH_CMD, DSH_HOME, EXE, HOME, PROFILES, THOUGHT_DIR } from '../core/paths.mjs';
import { read, readJson, patchPath, pkgPath, OVERLAY_MARK, modelsOf, modelOf, windowOf, modelIndent, depthOf, modelsReport, setModel, disabledIds, setDisabled, writePatch } from './models.mjs';
import { listPids, waitForExit, waitForStart, pluginsOf, bundleRowIds, addBundle, removeBundle, createProfile, dshPlugin } from './plugins.mjs';
import { cwdSlug, bareId, stamp, recentSessions, sessionTitle } from './sessions.mjs';
import { agentsOf, fleetOf, patchRows, skillsOf, AGENTS, PERSONA_HEADING, soulOf, setSoul } from './agents.mjs';
import { fmt, AGENTSETS, agentset, agentsetOf, profileRowOf, bindAgentset, agentsetCard, agentsetKeyboard } from './agentsets.mjs';
import { taskKeyboard, goalView, taskView, filterLogLines } from './tasks.mjs';
import { updatePolicy, bridgeRoot, copyRelease, installRelease, bridgeVersion, newestModuleMtime, npmLatest, npmLatestAsync } from './release.mjs';
import { resolveCd } from './cd-path.mjs';
import { permissionEnabled } from '../profile/permission-rows.mjs';

export async function handleSessionCommands(ctx) {
  const { command, arg, send, reply, log, profile, state, key, config, lang: rawLang } = ctx;
  // The topic's language, then the config default, then English. Never Russian:
  // a group that has no opinion still must not guess a language.
  const lang = normalizeLang(rawLang) || normalizeLang(config?.lang) || 'en';
  const say = (text, extra) => (extra ? reply(text, extra) : reply(text));
  const activeProfile = profile || config.profile || 'headless';
  const effective = ctx.effective || command;
  switch (effective) {
    case '/sessions': {
      const limit = Number.parseInt(arg, 10) > 0 ? Math.min(Number.parseInt(arg, 10), 20) : 8;
      const rows = recentSessions((state.cwd && state.cwd[key]) || config.cwd, limit, lang);
      if (rows.length === 0) {
        say(t(lang, 'ctrl.sessions.empty'));
        return true;
      }
      const lines = rows.map((row) => {
        const id = bareId(row.id);
        const current = bareId(state.sessions[key] || '') === id ? '*' : ' ';
        const when = new Date(row.mtime).toISOString().slice(5, 16).replace('T', ' ');
        return `${current} ${when}  ${row.title.slice(0, 48)}\n    /sessions ${id}`;
      });
      say([t(lang, 'ctrl.sessions.title'), ...lines].join('\n'));
      return true;
    }
    case '/resume': {
      const wanted = bareId((arg || '').trim());
      if (!wanted) {
        say(t(lang, 'ctrl.resume.usage'));
        return true;
      }
      state.sessions[key] = `session-${wanted}`;
      ctx.saveState();
      say(t(lang, 'ctrl.resume.done', { id: `session-${wanted}` }));
      return true;
    }
    case '/new': {
      delete state.sessions[key];
      ctx.saveState();
      say(t(lang, 'cmd.new.done'));
      return true;
    }
    case '/seed': {
      // Repair a topic that was created empty (Telegram keeps the text in the
      // General chat, so the thread shows a title with nothing under it).
      // Two forms: `/seed <text>` posts that text; `/seed` alone cannot know
      // the original message, so it explains the form instead of guessing.
      const body = (arg || '').trim();
      if (!ctx.threadId) {
        say(t(lang, 'ctrl.seed.noThread'));
        return true;
      }
      if (!body) {
        say(t(lang, 'ctrl.seed.usage'));
        return true;
      }
      if (!ctx.seedTopic) {
        say(t(lang, 'ctrl.seed.unsupported'));
        return true;
      }
      const res = await ctx.seedTopic(ctx.chatId, ctx.threadId, body);
      say(res ? t(lang, 'ctrl.seed.done', { id: res }) : t(lang, 'ctrl.seed.failed'));
      return true;
    }
    case '/rewind': {
      // Going back the way the desktop app's branch-from-here does. The file is
      // cut only where a turn begins, a copy of it is kept, and a turn that is
      // still running refuses the whole thing: a session being written is the
      // one file this must never touch.
      const sessionId = state.sessions[key] || '';
      if (!sessionId) { say(t(lang, 'ctrl.rewind.noSession')); return true; }
      const file = sessionFile(join(DSH_HOME, 'sessions'), sessionId);
      const wanted = String(arg || '').trim().toLowerCase();
      if (ctx.activeTurns && ctx.activeTurns.has(key)) { say(t(lang, 'ctrl.rewind.busy')); return true; }

      // Undo is its own verb: it restores the newest backup and says so.
      if (wanted === 'undo' || wanted === 'назад' || wanted === 'отмена') {
        const done = ctx.undoRewind ? ctx.undoRewind(file) : { error: 'no undo here' };
        if (done.error === 'nothing') { say(t(lang, 'ctrl.rewind.nothing')); return true; }
        say(done.error ? t(lang, 'ctrl.rewind.failed', { error: done.error }) : t(lang, 'ctrl.rewind.undone'));
        return true;
      }

      const steps = Number.parseInt(wanted, 10);
      if (!wanted || !Number.isInteger(steps) || steps < 1) {
        const card = renderRewindUsage({ t: (k, vars) => t(lang, k, vars), file, sessionId });
        await reply(card.text, card.keyboard.length ? { keyboard: card.keyboard } : undefined);
        return true;
      }

      // Say the number twice: the card already asks "back 2?" and this is the
      // proof that two is what will be cut.
      const plan = planRewind(file, steps);
      if (plan.reason) {
        const key2 = plan.reason === 'too-many-steps' ? 'ctrl.rewind.refused.too-many-steps' : `ctrl.rewind.refused.${plan.reason}`;
        say(t(lang, key2, { total: plan.total, dropped: steps }));
        return true;
      }
      const card = renderRewindCard({ t: (k, vars) => t(lang, k, vars), file, sessionId, steps, lang });
      await reply(card.text, { keyboard: card.keyboard });
      return true;
    }
    case '/fork': {
      // The desktop app's "branch from here", without losing the road you were
      // on: the session is not cut, a copy of it up to the branch point becomes
      // a session of its own, and this topic moves onto the copy. `/fork` alone
      // branches from the end; `/fork 2` branches from two turns back.
      const sessionId = state.sessions[key] || '';
      if (!sessionId) { say(t(lang, 'ctrl.fork.noSession')); return true; }
      if (ctx.activeTurns && ctx.activeTurns.has(key)) { say(t(lang, 'ctrl.fork.busy')); return true; }
      const wanted = String(arg || '').trim().toLowerCase();
      const steps = wanted ? Number.parseInt(wanted, 10) : 0;
      if (wanted && (!Number.isInteger(steps) || steps < 0)) { say(t(lang, 'ctrl.fork.usage')); return true; }
      const file = sessionFile(join(DSH_HOME, 'sessions'), sessionId);
      const plan = planFork(file, steps);
      if (plan.reason) {
        // The same refusals as a cut: a session being written is the one file
        // this must never copy, and the reason is the same sentence.
        say(t(lang, `ctrl.rewind.refused.${plan.reason}`, { total: plan.total, dropped: steps }));
        return true;
      }
      let made;
      try {
        made = applyFork(file, plan.offset, plan.size);
      } catch (error) {
        say(t(lang, 'ctrl.fork.failed', { error: error.message }));
        return true;
      }
      state.sessions[key] = made.id;
      state.forks = state.forks || {};
      const list = state.forks[key] || [];
      list.push({ id: made.id, from: sessionId, at: Date.now(), kept: plan.kept });
      // The last dozen is enough to pick from, and state.json stays small.
      state.forks[key] = list.slice(-12);
      ctx.saveState();
      log(`fork ${sessionId} -> ${made.id} at turn ${plan.kept} for ${key}`);
      say(t(lang, 'ctrl.fork.done', { id: made.id, kept: plan.kept }));
      return true;
    }
    case '/branches': {
      const list = state.forks?.[key] || [];
      const current = state.sessions[key] || '';
      if (!list.length) { say(t(lang, 'ctrl.fork.none')); return true; }
      const rows = list.map((entry) => [{
        text: `${entry.id === current ? '• ' : ''}${entry.id.slice(8, 16)} · ${t(lang, 'ctrl.fork.turns', { n: entry.kept })}`,
        data: `fk:${entry.id}`,
      }]);
      const head = [t(lang, 'ctrl.fork.list', { n: list.length }), t(lang, 'ctrl.fork.current', { id: current || '—' })];
      await reply(head.join('\n'), { keyboard: rows });
      return true;
    }
    case '/cd': {
      // Bind THIS topic to a project directory. Every later turn in the topic
      // spawns the CLI with that cwd, so "work in my-app" stops meaning
      // "cd ... in every single command".
      //
      // The same binding also narrows the host sandbox: the topic's derived
      // profile gets `workspaceRoot` = this directory, so a write outside it is
      // refused by the host, not discouraged by a prompt. `/cd <dir> wide` keeps
      // the old, profile-wide boundary for a topic that genuinely needs it.
      const parts = String(arg || '').trim().split(/\s+/).filter(Boolean);
      const wide = parts.length > 1 && parts[parts.length - 1].toLowerCase() === 'wide';
      const wanted = (wide ? parts.slice(0, -1).join(' ') : parts.join(' ')).replace(/^"|"$/g, '');
      state.cwd = state.cwd || {};
      if (!wanted) {
        // A topic without its own directory still has one: the bridge default.
        // Printing an empty line there reads as "nothing is bound".
        const current = state.cwd[key] || config.cwd || '';
        const lines = [
          t(lang, 'ctrl.cd.current'),
          current
            ? `${current}${state.cwd[key] ? '' : t(lang, 'ctrl.cd.defaultSuffix')}`
            : t(lang, 'ctrl.cd.unset'),
        ];
        if (state.cwd[key]) {
          lines.push(state.wide?.[key]
            ? t(lang, 'ctrl.cd.boundWide')
            : t(lang, 'ctrl.cd.boundNarrow'));
        }
        lines.push('', t(lang, 'ctrl.cd.bind'), t(lang, 'ctrl.cd.resetHint'));
        try {
          const dirs = readdirSync(config.projectsDir || join(HOME, 'Projects'), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
          if (dirs.length > 0) lines.push('', t(lang, 'ctrl.cd.projects'), dirs.slice(0, 20).join(' · '));
        } catch {}
        say(lines.join('\n'));
        return true;
      }
      if (wanted === 'reset') {
        delete state.cwd[key];
        if (state.wide) delete state.wide[key];
        ctx.saveState();
        say(t(lang, 'cmd.cd.reset'));
        return true;
      }
      // Resolution lives in `cd-path.mjs`: a pure table of the ways a person
      // spells a directory, so "is it a file?" and "did it try Projects?" are
      // tested instead of discovered in a turn that spawns in the wrong place.
      const resolved = resolveCd(wanted, {
        home: HOME,
        projectsDir: config.projectsDir || join(HOME, 'Projects'),
        configCwd: config.cwd || HOME,
        probe: (path) => {
          try {
            return statSync(path).isDirectory() ? 'dir' : 'file';
          } catch {
            return 'none';
          }
        },
      });
      if (resolved.error === 'notdir') {
        say(t(lang, 'cmd.cd.file', { path: resolved.path }));
        return true;
      }
      if (resolved.error) {
        say(t(lang, 'cmd.cd.none', { path: resolved.path }));
        return true;
      }
      state.cwd[key] = resolved.path;
      state.wide = state.wide || {};
      if (wide) state.wide[key] = true;
      else delete state.wide[key];
      ctx.saveState();
      // Say which boundary the topic now has. "Bound" alone reads as "the agent
      // may write here", and with `wide` that would be the opposite of the truth.
      // The boundary only exists when the profile can express one; reading the
      // patch here keeps this file out of the profile module's import cycle.
      let narrow = false;
      try {
        const patch = readFileSync(join(DSH_HOME, 'profiles', activeProfile, 'cordis.patch.yml'), 'utf8');
        narrow = permissionEnabled(patch);
      } catch {
        narrow = false;
      }
      say(t(lang, narrow ? 'cmd.cd.boundNarrow' : 'cmd.cd.bound', { path: resolved.path }));
      return true;
    }
    case '/menu': {
      // Two ways in. `/menu` is the hub card: six sections, each one a page of
      // commands that replace the card in place, so nobody has to spell a
      // command and the chat keeps one message instead of a wall of them.
      // `/menu on|off` is the other way: a Telegram reply keyboard under the
      // message field, which is what a person who does not read commands at all
      // needs — and it can be taken away again.
      const page = String(arg || '').trim().toLowerCase();
      if (page === 'on' || page === 'off') {
        state.menu = state.menu || {};
        state.menu[key] = page === 'on';
        ctx.saveState();
        log(`menu keyboard ${page} for ${key}`);
        await reply(
          t(lang, page === 'on' ? 'ctrl.menu.keyOn' : 'ctrl.menu.keyOff'),
          page === 'on' ? { persistent: replyKeyboard({ t: (k, vars) => t(lang, k, vars) }) } : { removeKeyboard: true },
        );
        return true;
      }
      const card = renderPanel({
        t: (k, vars) => t(lang, k, vars),
        page: MENU_GROUPS.includes(page) ? page : '',
      });
      await reply(card.text, { keyboard: card.keyboard });
      return true;
    }
    default:
      return false;
  }
}
