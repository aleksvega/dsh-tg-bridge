// Plugins from the chat: the list, the actions, and the release feed.
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
import { taskKeyboard, goalView, taskView, filterLogLines } from './tasks.mjs';
import { updatePolicy, bridgeRoot, copyRelease, installRelease, bridgeVersion, newestModuleMtime, npmLatest, npmLatestAsync } from './release.mjs';

export async function handlePluginCommands(ctx) {
  const { command, arg, send, reply, log, profile, state, key, config, lang: rawLang, saveState } = ctx;
  // The topic's language, then the config default, then English. Never Russian:
  // a group that has no opinion still must not guess a language.
  const lang = normalizeLang(rawLang) || normalizeLang(config?.lang) || 'en';
  const say = (text, extra) => (extra ? reply(text, extra) : reply(text));
  const activeProfile = profile || config.profile || 'headless';
  const effective = ctx.effective || command;
  switch (effective) {
    case '/plugins': {
      const target = arg === 'headless' ? 'headless' : 'desktop';
      const { bundles, disabled, deps } = pluginsOf(target);
      const lines = bundles.map((name) => {
        const rowIds = bundleRowIds(target, name);
        const off = rowIds.length > 0 && rowIds.every((id) => disabled.includes(id));
        return `${off ? '×' : '✓'} ${name}${off ? t(lang, 'ctrl.plugins.disabledSuffix') : ''}`;
      });
      const orphan = deps.filter((name) => !bundles.includes(name));
      say(
        [
          t(lang, 'ctrl.plugins.title', { name: target, n: bundles.length }),
          ...lines,
          orphan.length ? `\n${t(lang, 'ctrl.plugins.orphans')}\n${fmt(orphan)}` : '',
          `\n${t(lang, 'ctrl.plugins.disabledRows', {
            list: disabled.length ? disabled.join(', ') : t(lang, 'ctrl.plugins.disabledNone'),
          })}`,
          // The actions live behind the same command, so the list must say how
          // to reach them — otherwise people keep hunting for `/plugin`.
          `\n${t(lang, 'ctrl.plugins.actions')}`,
          t(lang, 'ctrl.plugins.profileHint'),
        ]
          .filter(Boolean)
          .join('\n'),
      );
      return true;
    }
    case '/plugin': {
      const [action, ...rest] = (arg || '').split(/\s+/);
      // The profile used to be the literal 'desktop' no matter which topic asked
      // and no matter which profile the install had — on a fresh machine the only
      // in-chat install therefore wrote into a profile that does not exist. The
      // topic's own profile is the default now, and an explicit `headless` or
      // `desktop` word overrides it: `/plugin add x`, `/plugin add headless x`
      // and `/plugin add x headless` all mean the same thing, because the help
      // text says "add headless or desktop at the end".
      const profileWord = (word) => word === 'headless' || word === 'desktop';
      const words = rest.filter(Boolean).slice();
      let target = activeProfile;
      if (words.length > 1 && profileWord(words[0])) target = words.shift();
      else if (words.length > 1 && profileWord(words[words.length - 1])) target = words.pop();
      const value = words.join(' ').trim();
      if (action === 'search' || action === 'find') {
        // The marketplace, from the chat. A word is optional: with none, the
        // registry lists what DSH plugins exist at all — the question the
        // desktop app answers with a page.
        const found = await searchPlugins(value, { fetchImpl: ctx.fetch || fetch });
        if (!found.ok) {
          say(t(lang, 'ctrl.plugin.searchFailed', { err: found.error }));
          return true;
        }
        if (!found.rows.length) {
          say(t(lang, 'ctrl.plugin.searchEmpty', { word: value || 'dsh-plugin' }));
          return true;
        }
        const installed = new Set(pluginsOf(target).bundles);
        const body = found.rows.map((row) => rowLine(row, installed.has(row.name))).join('\n\n');
        // A button under a result is the shortest honest path from "I found it"
        // to "it is installed": it runs `/plugin add <name>` and nothing else.
        say(
          [
            t(lang, 'ctrl.plugin.searchTitle', {
              n: found.rows.length,
              word: value || t(lang, 'ctrl.plugin.searchAll'),
              profile: target,
            }),
            '',
            body,
            '',
            t(lang, 'ctrl.plugin.searchHint'),
          ].join('\n'),
          {
            keyboard: found.rows.slice(0, 6).map((row) => [
              { text: `+ ${row.name}`, callback_data: `pl:i:${row.name}` },
            ]),
          },
        );
        return true;
      }
      if (action === 'info' || action === 'about') {
        // What the desktop marketplace shows before you install: who wrote it,
        // under what licence, and — the one that decides the outcome — whether
        // the manifest declares itself a DSH plugin at all.
        const got = await pluginInfo(value, { fetchImpl: ctx.fetch || fetch });
        if (!got.ok) {
          say(got.status === 404
            ? t(lang, 'ctrl.plugin.infoMissing', { name: value })
            : t(lang, 'ctrl.plugin.infoFailed', { err: got.error }));
          return true;
        }
        const info = got.info;
        const have = readJson(join(PROFILES, target, 'node_modules', info.name, 'package.json'))?.version || '';
        const lines = [
          `${info.name} ${info.version}`,
          info.description ? `${info.description}` : '',
          have
            ? t(lang, 'ctrl.plugin.infoInstalled', { version: have, profile: target })
            : t(lang, 'ctrl.plugin.infoNotInstalled', { profile: target }),
          have && isNewer(info.version, have)
            ? t(lang, 'ctrl.plugin.infoNewer', { version: info.version, name: info.name })
            : '',
          info.license ? t(lang, 'ctrl.plugin.infoLicense', { value: info.license }) : '',
          info.repository ? t(lang, 'ctrl.plugin.infoRepo', { value: info.repository }) : '',
          info.keywords.length ? t(lang, 'ctrl.plugin.infoKeywords', { list: info.keywords.join(', ') }) : '',
          t(lang, info.bundle ? 'ctrl.plugin.infoBundle' : 'ctrl.plugin.infoPlain'),
          info.engines ? `DSH: ${info.engines}` : '',
        ].filter(Boolean);
        say(lines.join('\n'), have ? {} : {
          keyboard: [[{ text: `+ ${info.name}`, callback_data: `pl:i:${info.name}` }]],
        });
        return true;
      }
      if (action === 'update' || action === 'upgrade') {
        // Saying one word must not start a pnpm run per plugin: a wordless
        // request reports what is behind and offers one button per package, and
        // an update happens only when its name is named.
        const names = value ? [value] : pluginsOf(target).bundles;
        if (!value) {
          const shown = [];
          for (const name of names) {
            const have = readJson(join(PROFILES, target, 'node_modules', name, 'package.json'))?.version || '';
            const got = await pluginInfo(name, { fetchImpl: ctx.fetch || fetch });
            if (!got.ok || !have || !isNewer(got.info.version, have)) continue;
            shown.push({ name, from: have, to: got.info.version });
          }
          if (!shown.length) {
            say(t(lang, 'ctrl.plugin.upToDateAll', { profile: target }));
            return true;
          }
          say(
            [
              t(lang, 'ctrl.plugin.updateTitle', { n: shown.length, profile: target }),
              '',
              ...shown.map((row) => `${row.name} ${row.from} → ${row.to}`),
              '',
              t(lang, 'ctrl.plugin.updateHint'),
            ].join('\n'),
            { keyboard: shown.slice(0, 8).map((row) => [{ text: `↑ ${row.name}`, callback_data: `pl:u:${row.name}` }]) },
          );
          return true;
        }
        const name = value;
        const have = readJson(join(PROFILES, target, 'node_modules', name, 'package.json'))?.version || '';
        const got = await pluginInfo(name, { fetchImpl: ctx.fetch || fetch });
        if (!got.ok) {
          say(t(lang, 'ctrl.plugin.updateFailed', { name, err: got.error }));
          return true;
        }
        if (have && !isNewer(got.info.version, have)) {
          say(t(lang, 'ctrl.plugin.upToDate', { name, version: have }));
          return true;
        }
        say(t(lang, 'ctrl.plugin.updating', { profile: target, n: 1 }));
        const result = await dshPlugin(target, ['add', `${name}@latest`]);
        say(result.code === 0
          ? t(lang, 'ctrl.plugin.updated', { name, from: have || '—', to: got.info.version })
          : t(lang, 'ctrl.plugin.updateFailed', { name, err: result.out.slice(-300) }));
        return true;
      }
      if (!action || !value) {
        say(t(lang, 'ctrl.plugin.usage'));
        return true;
      }
      if (action === 'disable' || action === 'enable') {
        const ok = setDisabled(target, value, action === 'disable');
        say(ok
          ? t(lang, 'ctrl.plugin.rowToggled', {
              id: value,
              state: t(lang, action === 'disable' ? 'ctrl.plugin.off' : 'ctrl.plugin.on'),
              profile: target,
            })
          : t(lang, 'ctrl.plugin.rowMissing', { id: value, profile: target }));
        return true;
      }
      if (action === 'add') {
        say(t(lang, 'ctrl.plugin.adding', { name: value, profile: target }));
        const result = await dshPlugin(target, ['add', value]);
        const name = (() => {
          try {
            const pkg = readJson(join(PROFILES, target, 'node_modules', value.split('/').pop(), 'package.json'));
            return pkg?.name || value;
          } catch {
            return value;
          }
        })();
        const meta = readJson(join(PROFILES, target, 'node_modules', name, 'package.json'));
        const bundled = Boolean(meta && (meta.dsh || {}).bundle);
        const outcome = t(lang, result.code === 0 ? 'ctrl.plugin.installed' : 'ctrl.plugin.pnpmFailed');
        if (bundled && addBundle(target, name)) {
          say(t(lang, 'ctrl.plugin.addedBundled', { state: outcome, name, out: result.out.slice(-800) }));
        } else {
          say(t(lang, 'ctrl.plugin.added', {
            state: outcome,
            name: value,
            out: `${result.out.slice(-800)}${bundled ? '' : t(lang, 'ctrl.plugin.noBundle')}`,
          }));
        }
        return true;
      }
      if (action === 'remove') {
        say(t(lang, 'ctrl.plugin.removing', { name: value, profile: target }));
        const result = await dshPlugin(target, ['remove', value]);
        removeBundle(target, value);
        say(t(lang, 'ctrl.plugin.removed', {
          state: t(lang, result.code === 0 ? 'ctrl.plugin.installed' : 'ctrl.plugin.pnpmFailed'),
          name: value,
          out: result.out.slice(-800),
        }));
        return true;
      }
      say(t(lang, 'ctrl.plugin.unknownAction'));
      return true;
    }
    case '/subscribe': {
      // A notice per new release, at most once per release, and nothing when the
      // registry does not answer. Not a command menu entry: it is one line, and
      // a person who turns it off should not have to find it again in /help.
      const policy = updatePolicy(state);
      const installed = bridgeVersion();
      const latest = npmLatest('dsh-tg-bridge');
      const [on] = String(arg).trim().split(/\s+/);
      if (on === 'on' || on === 'off') {
        policy.mode = on === 'on' ? 'check' : 'off';
        policy.pinned = on === 'off' ? installed : '';
        policy.notified = latest;
        saveState();
        say(t(lang, on === 'on' ? 'ctrl.subscribe.on' : 'ctrl.subscribe.off', { v: installed || '?' }));
        return true;
      }
      const where = policy.mode === 'off' ? t(lang, 'ctrl.subscribe.stateOff') : t(lang, 'ctrl.subscribe.stateOn');
      say(`${t(lang, 'ctrl.subscribe.title')}\n${where}\n${describeUpdate(updateState({ installed, latest, mode: policy.mode, notified: policy.notified }))}`);
      return true;
    }
    default:
      return false;
  }
}
