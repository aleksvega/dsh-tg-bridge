// What the agent knows and who it is: skills, the persona file, and the crew it can call.
//
// One group of the `/` surface. `control.mjs` owns the dispatch and this file
// owns the commands, so a change to `/agents` no longer touches `/update`.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
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

export async function handleSkillCommands(ctx) {
  const { command, arg, send, reply, log, profile, state, key, config, lang: rawLang } = ctx;
  // The topic's language, then the config default, then English. Never Russian:
  // a group that has no opinion still must not guess a language.
  const lang = normalizeLang(rawLang) || normalizeLang(config?.lang) || 'en';
  const say = (text, extra) => (extra ? reply(text, extra) : reply(text));
  const activeProfile = profile || config.profile || 'headless';
  const effective = ctx.effective || command;
  switch (effective) {
    case '/skills': {
      const rows = skillsOf();
      const want = (arg || '').trim();
      if (want) {
        // A skill is one directory under `skills/`, and the name here is whatever
        // was typed: `join` walks out of the root for `../..`, so the resolved
        // path is checked to still be inside before anything is read. The old
        // code could be pointed at any `SKILL.md` on the disk.
        const root = join(DSH_HOME, 'skills');
        const dir = join(root, want);
        const inside = relative(root, dir);
        if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
          say(t(lang, 'ctrl.skills.none', { name: want }));
          return true;
        }
        const body = read(join(dir, 'SKILL.md'));
        say(body
          ? t(lang, 'ctrl.skills.body', { name: want, body: body.slice(0, 3000) })
          : t(lang, 'ctrl.skills.none', { name: want }));
        return true;
      }
      say(rows.length
        ? t(lang, 'ctrl.skills.title', { n: rows.length, list: fmt(rows) })
        : t(lang, 'ctrl.skills.empty'));
      return true;
    }
    case '/soul': {
      const text = (arg || '').trim();
      if (!text) {
        const current = soulOf();
        say(current
          ? t(lang, 'ctrl.soul.title', { path: AGENTS, text: current })
          : t(lang, 'ctrl.soul.empty', { path: AGENTS }));
        return true;
      }
      setSoul(text);
      say(t(lang, 'ctrl.soul.saved'));
      return true;
    }
    case '/crew': {
      const store = agentset();
      if (store.error) say(t(lang, 'ctrl.set.storeBroken', { error: store.error }));
      const bound = state.agentsets?.[key] || '';
      const ids = () => store.list().map((set) => set.id).join(', ');
      const parts = String(arg || '').trim().split(/\s+/).filter(Boolean);
      const verb = (parts[0] || '').toLowerCase();
      const rest = parts.slice(1);
      const text = (value) => rest.join(' ').trim();

      /** Shared failure lanes: every write reports the same three ways. */
      const commit = (id, result) => {
        if (result.ok) return true;
        if (result.error === 'stale') say(t(lang, 'ctrl.set.stale'));
        else if (result.error === 'unreadable') say(t(lang, 'ctrl.set.unreadable', { error: result.file || AGENTSETS }));
        else if (result.error === 'builtin-readonly') say(t(lang, 'ctrl.set.builtinReadonly', { id }));
        else if (result.error === 'bad-id') say(t(lang, 'ctrl.set.badId'));
        else if (result.error === 'missing') say(t(lang, 'ctrl.set.unknown', { id, list: ids() }));
        else say(t(lang, 'ctrl.set.failed', { error: result.error || '?' }));
        return false;
      };

      if (!verb) {
        const sets = store.list();
        const lines = [
          t(lang, 'ctrl.set.list', { n: sets.length }),
          ...sets.map((set) => {
            const mark = set.id === bound ? '•' : ' ';
            const note = set.builtin ? t(lang, 'ctrl.set.builtin') : set.notes || t(lang, 'ctrl.set.custom');
            return `${mark} ${set.id} — ${set.name || set.id} (${note})`;
          }),
          '',
          bound ? t(lang, 'ctrl.set.boundNow', { name: store.get(bound)?.name || bound }) : t(lang, 'ctrl.set.noneBound', { profile: activeProfile }),
          t(lang, 'ctrl.set.usage'),
          t(lang, 'ctrl.set.hint'),
        ];
        say(lines.join('\n'));
        return true;
      }

      if (verb === 'show') {
        const set = store.get(rest[0] || bound);
        if (!set) {
          say(t(lang, 'ctrl.set.unknown', { id: rest[0] || '', list: ids() }));
          return true;
        }
        say(agentsetCard(set, lang, activeProfile, bound));
        return true;
      }

      if (verb === 'use') {
        const id = rest[0] || '';
        const set = store.get(id);
        if (!set) {
          say(t(lang, 'ctrl.set.unknown', { id, list: ids() }));
          return true;
        }
        if (bound === id) {
          say(t(lang, 'ctrl.set.same'));
          return true;
        }
        // Binding a builtin is fine: nobody writes to it, it is only a
        // starting point that the profile tier still overrides per field.
        bindAgentset(state, key, id);
        // A set that carries language or the thinking block changes this topic's
        // own preferences too; those live in state, not in the profile.
        if (set.lang) state.lang = { ...(state.lang || {}), [key]: set.lang };
        if (set.thinkBlock) state.thinkBlock = { ...(state.thinkBlock || {}), [key]: set.thinkBlock };
        ctx.saveState();
        say(t(lang, 'ctrl.set.bound', { name: set.name || set.id }));
        return true;
      }

      if (verb === 'off') {
        if (!bound) {
          say(t(lang, 'ctrl.set.same'));
          return true;
        }
        bindAgentset(state, key, '');
        ctx.saveState();
        say(t(lang, 'ctrl.set.unbound', { profile: activeProfile }));
        return true;
      }

      if (verb === 'new' || verb === 'copy') {
        // `/agentset new <name> [from <id>]`, and the shorthand
        // `/agentset copy <name> <id>`.
        const fromWord = rest.indexOf('from', 1);
        const bare = fromWord > 0 ? rest.slice(0, fromWord).join(' ') : rest[0] || '';
        const sourceId = fromWord > 0 ? rest[fromWord + 1] || '' : rest[1] || '';
        const source = sourceId ? store.get(sourceId) : null;
        if (sourceId && !source) {
          say(t(lang, 'ctrl.set.unknown', { id: sourceId, list: ids() }));
          return true;
        }
        const id = slugId(bare || sourceId);
        if (!id) {
          say(t(lang, 'ctrl.set.badId'));
          return true;
        }
        if (store.get(id)) {
          say(t(lang, 'ctrl.set.exists', { id }));
          return true;
        }
        const next = source ? { ...source, id, name: bare || id, builtin: false, createdAt: undefined } : emptySet(id, bare || id);
        if (commit(id, store.put(next))) say(t(lang, 'ctrl.set.created', { id }));
        return true;
      }

      if (verb === 'rm') {
        const id = rest[0] || '';
        const set = store.get(id);
        if (!set) {
          say(t(lang, 'ctrl.set.unknown', { id, list: ids() }));
          return true;
        }
        const users = Object.entries(state.agentsets || {}).filter(([, ref]) => ref === id).map(([ref]) => ref);
        if (users.length > 0) {
          say(t(lang, 'ctrl.set.inUse', { id, keys: users.join(', ') }));
          return true;
        }
        if (commit(id, store.remove(id))) say(t(lang, 'ctrl.set.removed', { id }));
        return true;
      }

      if (verb === 'reload') {
        agentsetStore = new AgentsetStore(AGENTSETS).load();
        say(agentset().error ? t(lang, 'ctrl.set.storeBroken', { error: agentset().error }) : t(lang, 'ctrl.set.reloaded', { n: agentset().list().length }));
        return true;
      }

      // Anything else is a field edit on a set: `/agentset model glm-5.3 [id]`,
      // `/agentset model inherit`. The DSH profile keeps its own /agents set …
      // verbs; this one only ever writes the topic's set.
      const field = verb;
      const known = new Set(['model', 'effort', 'permissions', 'preset', 'lang', 'notes']);
      if (!known.has(field)) {
        say(t(lang, 'ctrl.set.badField', { field, list: [...known].join(', ') }));
        return true;
      }
      // The last word names the set only when it is one; otherwise the whole
      // tail is the value ("/agentset model glm 5.3" would be a model id).
      const maybe = store.get(rest[rest.length - 1]);
      const target = maybe || (bound ? store.get(bound) : null);
      const set = target || store.get(rest[0]);
      if (!set) {
        say(t(lang, 'ctrl.set.unknown', { id: rest[rest.length - 1] || '', list: ids() }));
        return true;
      }
      const valueWords = maybe ? rest.slice(0, -1) : rest;
      const value = valueWords.join(' ').trim();
      const cleared = !value || value === 'inherit' || value === '-';
      const storeField = field === 'preset' ? 'dshPreset' : field;
      const next = { ...set, [storeField]: cleared ? '' : value };
      if (commit(set.id, store.put(next))) {
        say(cleared ? t(lang, 'ctrl.set.fieldCleared', { field }) : t(lang, 'ctrl.set.fieldSet', { field, value, name: set.name || set.id }));
      }
      return true;
    }
    default:
      return false;
  }
}
