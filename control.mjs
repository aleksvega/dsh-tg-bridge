// dsh-telegram-bridge — control plane.
//
// The command surface that makes DSH manageable from Telegram with no UI:
// profiles, model, sessions, plugins (extensions), skills, persona, restarts.
// Everything works on the same files DSH itself reads, so a running desktop app
// and a headless turn see the same state; commands that need a reload say so.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, LANGS, normalizeLang } from './i18n.mjs';
import { addTask, clearGoal, doneTask, editTask, finishGoal, goalOf, progressOf, reopenGoal, removeTask, setGoal } from './goals.mjs';
import { lastTurnReasoning, lastTurnReasoningSteps, lastTurnText, reasoningMarkdown, sessionFile, sessionReasoningSteps, sessionStats } from './thoughts.mjs';
import { parseAgentPresets, parseModelSelection, parsePermissionPresets, parseReasoningEfforts, parseSubagentFleet, parseSubagentRows } from './agents.mjs';
import { setRowConfig, unsetRowConfig } from './profile-edit.mjs';
import { parseReminder, stampAt, upcoming } from './reminders.mjs';
import { AgentsetStore, emptySet, slugId } from './agentsets.mjs';
import { SETTINGS_PAGES, renderSettingsCard, settingsCurrent } from './settings-card.mjs';
import { applyFork, planFork, planRewind } from './rewind.mjs';
import { cutSession, isRewindPress } from './rewind-buttons.mjs';
import { renderRewindCard, renderRewindUsage } from './rewind-card.mjs';
import { MENU_GROUPS, commandForName, renderPanel, replyKeyboard } from './menu-card.mjs';
import { explainCommand } from './help-explain.mjs';
import { profileValues, resolveSettings } from './settings.mjs';
import { UPDATE_DEFAULTS, describeUpdate, modeChange, updateState } from './update-policy.mjs';
import { isNewer, pluginInfo, rowLine, searchPlugins } from './plugin-search.mjs';
import { COMMAND_ALIASES, CONTROL_COMMANDS, DOCUMENTED_COMMANDS } from './commands-registry.mjs';

import { handleAgentCommands } from './control/cmd-agents.mjs';
import { handleBridgeCommands } from './control/cmd-bridge.mjs';
import { handlePluginCommands } from './control/cmd-plugin.mjs';
import { handleSessionCommands } from './control/cmd-session.mjs';
import { handleSkillCommands } from './control/cmd-skills.mjs';
import { handleTaskCommands } from './control/cmd-task.mjs';
import { handleViewCommands } from './control/cmd-views.mjs';
import { APP, CLI_JS, DSH_CMD, DSH_HOME, EXE, HOME, PROFILES, THOUGHT_DIR } from './paths.mjs';
import { read, readJson, patchPath, pkgPath, OVERLAY_MARK, modelsOf, modelOf, windowOf, modelIndent, depthOf, modelsReport, setModel, disabledIds, setDisabled, writePatch } from './control/models.mjs';
import { listPids, waitForExit, waitForStart, pluginsOf, bundleRowIds, addBundle, removeBundle, createProfile, dshPlugin } from './control/plugins.mjs';
import { cwdSlug, bareId, stamp, recentSessions, sessionTitle } from './control/sessions.mjs';
import { agentsOf, fleetOf, patchRows, skillsOf, AGENTS, PERSONA_HEADING, soulOf, setSoul } from './control/agents.mjs';
import { fmt, AGENTSETS, agentset, agentsetOf, profileRowOf, bindAgentset, agentsetCard, agentsetKeyboard } from './control/agentsets.mjs';
import { taskKeyboard, goalView, taskView, reasoningOf, filterLogLines } from './control/tasks.mjs';
import { updatePolicy, bridgeRoot, copyRelease, installRelease, bridgeVersion, newestModuleMtime, npmLatest, npmLatestAsync } from './control/release.mjs';

export async function handleControl(ctx) {
  const { command, arg, send, reply, log, profile, state, key, config, lang: rawLang } = ctx;
  // The topic's language, then the config default, then English — the same order
  // `resolveLang` uses. Nothing here may fall back to Russian: a reader who never
  // chose a language is not necessarily Russian.
  const lang = normalizeLang(rawLang) || normalizeLang(config?.lang) || 'en';
  // `reply(text, { keyboard })` draws buttons under the message; `say` is the
  // common case of a message with none.
  const say = (text, extra) => (extra ? reply(text, extra) : reply(text));
  // A topic can run on its own profile (its own plugins, model and skills);
  // without one it follows the install default.
  const activeProfile = profile || config.profile || 'headless';

  // Old spellings of a command route to the one name that owns the job, before
  // anything else looks at the argument.
  const bare = command.startsWith('/') ? command.slice(1) : command;
  const canonical = COMMAND_ALIASES[bare];
  let effective = canonical ? `/${canonical}` : command;

  // One command for one job: `/plugins` is both the list and the way to change
  // things. Two near-identical names (`/plugin` / `/plugins`) invited the exact
  // mistake of typing the plural with an action. The singular form stays as an
  // alias so old instructions and muscle memory keep working.
  if (effective === '/plugins') {
    const [maybeAction] = String(arg || '').trim().split(/\s+/);
    // `/plugins add|remove|disable|enable …` is the same work as `/plugin …`;
    // the case bodies read `arg`, which already holds the action and its value.
    if (['add', 'remove', 'disable', 'enable', 'search', 'find', 'info', 'about', 'update', 'upgrade'].includes((maybeAction || '').toLowerCase())) {
      effective = '/plugin';
    }
  }

  // Each group owns one slice of the surface and answers `false` for anything
  // that is not its job. The order is alphabetical, not meaningful: no two
  // groups claim the same command, so a miss falls through to `default` below.
  const child = { ...ctx, effective, command, arg, send, reply, log, profile, state, key, config, lang };
  for (const handler of [handleAgentCommands, handleBridgeCommands, handlePluginCommands, handleSessionCommands, handleSkillCommands, handleTaskCommands, handleViewCommands]) {
    if (await handler(child)) return true;
  }
  // Nothing claimed it: the bridge answers an unknown `/` command itself, with
  // the same words whether the name was never ours or was retired.
  return false;
}

// The outside world imports these from `control.mjs`, so the move into `control/`
// keeps its promises: same names, same module, different file.
export { COMMAND_ALIASES, CONTROL_COMMANDS, DOCUMENTED_COMMANDS } from './commands-registry.mjs';
export { copyRelease } from './control/release.mjs';
export { filterLogLines, reasoningOf } from './control/tasks.mjs';
export { DSH_HOME } from './paths.mjs';
export { modelOf, modelsOf, pluginsOf, recentSessions, skillsOf, soulOf, bridgeVersion, npmLatest, npmLatestAsync, installRelease };
