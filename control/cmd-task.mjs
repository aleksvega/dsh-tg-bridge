// The to-do list a person keeps in a topic: the goal, its tasks, jobs and reminders.
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
import { CAP_CHOICES, CAP_MAX, CAP_MIN, setParallel } from '../work/jobs-cap.mjs';

export async function handleTaskCommands(ctx) {
  const { command, arg, send, reply, log, profile, state, key, config, lang: rawLang } = ctx;
  // The topic's language, then the config default, then English. Never Russian:
  // a group that has no opinion still must not guess a language.
  const lang = normalizeLang(rawLang) || normalizeLang(config?.lang) || 'en';
  const say = (text, extra) => (extra ? reply(text, extra) : reply(text));
  const activeProfile = profile || config.profile || 'headless';
  const effective = ctx.effective || command;
  switch (effective) {
    case '/goal': {
      const L = lang;
      const body = (arg || '').trim();
      const current = goalOf(state, key);
      if (!body) {
        say(current ? goalView(current, L) : t(L, 'goal.none'));
        return true;
      }
      const word = body.toLowerCase();
      if (word === 'help' || word === '?') {
        say(t(L, 'goal.usage'));
        return true;
      }
      if (word === 'done') {
        const goal = finishGoal(state, key);
        if (!goal) { say(t(L, 'goal.none')); return true; }
        ctx.saveState();
        say(goalView(goal, L));
        return true;
      }
      if (word === 'reopen') {
        // The way back from `/goal done`, and the only way: editing the text of a
        // closed goal keeps it closed.
        const again = reopenGoal(state, key);
        if (!again) { say(t(L, 'goal.reopenFailed')); return true; }
        ctx.saveState();
        say(t(L, 'goal.reopened'));
        return true;
      }
      if (word === 'clear') {
        say(t(L, clearGoal(state, key) ? 'goal.cleared' : 'goal.none'));
        if (goalOf(state, key) === null) ctx.saveState();
        return true;
      }
      const wasClosed = Boolean(current?.done);
      const goal = setGoal(state, key, body);
      if (!goal) { say(t(L, 'goal.usage')); return true; }
      ctx.saveState();
      say([t(L, 'goal.set'), wasClosed ? t(L, 'goal.stillClosed') : '', goalView(goal, L)].filter(Boolean).join('\n'));
      return true;
    }
    case '/tasks': {
      // One command, one name. The card is the control — a tap marks a task
      // done — and the same command takes the typed form:
      //
      //   /tasks              the card, a button per task
      //   /tasks 3            mark task 3 done, then redraw the card
      //   /tasks done 3       the same, said out loud
      //   /tasks rm 3         remove it
      //   /tasks edit 3 text  reword it, keeping the number
      //   /tasks any text     add it
      //
      // `/task` still works as an undocumented alias: a phone keyboard turns one
      // spelling into the other without the person noticing, and a name that is
      // never advertised is a name nobody has to remember. The menu used to show
      // both, which is what made the list look like noise.
      const L = lang;
      const body = String(arg || '').trim();
      const current = goalOf(state, key);
      if (!current) { say(t(L, 'task.none')); return true; }
      if (body.toLowerCase() === 'help' || body.toLowerCase() === '?') {
        say(t(L, 'task.usage'));
        return true;
      }
      if (/^\d+$/.test(body)) {
        const n = Number(body);
        say(t(L, doneTask(state, key, n) ? 'task.done' : 'task.bad', { n }));
        ctx.saveState();
        const goal = goalOf(state, key);
        const rows = goal ? taskKeyboard(goal) : [];
        if (rows.length) await reply(taskView(goal, L), { keyboard: rows });
        else say(taskView(goal, L));
        return true;
      }
      if (!body) {
        const rows = taskKeyboard(current);
        const hint = String(arg || '').trim() ? `\n${t(L, 'task.tasksHint')}` : '';
        if (rows.length === 0) { say(`${taskView(current, L)}${hint}`); return true; }
        await reply(`${taskView(current, L)}${hint}`, { keyboard: rows });
        return true;
      }
      // Editing keeps the number: the chat has been quoting "5." and a delete
      // plus an add would renumber everything below it.
      const edit = body.match(/^(?:edit|set)\s+(\d+)\s+([\s\S]+)$/i);
      if (edit) {
        const n = Number(edit[1]);
        say(editTask(state, key, n, edit[2]) ? t(L, 'task.edited', { n }) : t(L, 'task.bad', { n }));
        ctx.saveState();
        return true;
      }
      const op = body.match(/^(done|rm|remove)\s+(\d+)$/i);
      if (op) {
        const n = Number(op[2]);
        if (op[1].toLowerCase() === 'done') {
          say(t(L, doneTask(state, key, n) ? 'task.done' : 'task.bad', { n }));
        } else {
          say(t(L, removeTask(state, key, n) ? 'task.removed' : 'task.bad', { n }));
        }
        ctx.saveState();
        return true;
      }
      const added = addTask(state, key, body);
      if (!added) { say(t(L, 'task.usage')); return true; }
      ctx.saveState();
      const goal = goalOf(state, key);
      say(`${t(L, 'task.added', { n: added })}\n${goalView(goal, L)}`);
      return true;
    }
    case '/jobs': {
      // A turn is one short-lived process, so DSH's own job list dies with it.
      // What survives — and what a person waiting on a reply actually needs —
      // is the bridge's queue: which topics are running now, for how long, and
      // how many waits behind them.
      //
      // The card also owns the ceiling. It was a config-file key nobody could
      // reach from the chat, and a wrong value showed up as "your message is
      // waiting for a free slot" with no way to widen it. `/jobs 5` sets it, and
      // so does a button — both through `setParallel`, so they cannot disagree,
      // and the card is redrawn either way, so the answer is the new state.
      const asked = String(arg || '').trim();
      let set = null;
      if (asked) {
        set = setParallel(asked, { config, saveConfig: ctx.saveConfig, log });
        if (!set.ok) {
          say(t(lang, 'ctrl.jobs.capRange', { min: CAP_MIN, max: CAP_MAX }));
          return true;
        }
      }
      const snapshot = ctx.jobs ? ctx.jobs() : { active: [], queued: 0, max: 0 };
      const lines = [];
      // One message: what changed, then the state it changed to. Two messages
      // for one tap is noise in a chat that is already long.
      if (set) lines.push(t(lang, set.saved ? 'ctrl.jobs.capSet' : 'ctrl.jobs.capUnsaved', { n: set.n }), '');
      lines.push(t(lang, 'ctrl.jobs.title'));
      if (snapshot.active.length === 0) {
        lines.push(t(lang, 'ctrl.jobs.idle'));
      } else {
        for (const turn of snapshot.active) {
          const title = state.titles?.[turn.key] || (turn.key === key ? t(lang, 'ctrl.jobs.thisTopic') : t(lang, 'ctrl.jobs.otherTopic'));
          const mins = turn.startedAt ? Math.max(1, Math.round((Date.now() - turn.startedAt) / 60000)) : 0;
          lines.push(t(lang, 'ctrl.jobs.running', { title, mins }));
        }
      }
      lines.push(t(lang, 'ctrl.jobs.queued', { n: snapshot.queued, max: snapshot.max }));
      lines.push(t(lang, 'ctrl.jobs.hint'));
      const cap = Number(snapshot.max) || 0;
      lines.push(t(lang, 'ctrl.jobs.cap', { n: cap }));
      // The numbers a person actually picks from. `jb:` is answered in
      // callbacks.mjs by running `/jobs <n>`, the same command this argument runs.
      const rows = [CAP_CHOICES.map((n) => ({
        text: n === cap ? `• ${n}` : String(n),
        data: `jb:${n}`,
      }))];
      say(lines.join('\n'), { keyboard: rows });
      return true;
    }
    case '/remind': {
      // A reminder is not a turn: the bridge stays alive between messages, so
      // it owns the clock. A DSH schedule would live inside a one-shot turn and
      // would never fire.
      const input = String(arg || '').trim();
      const now = Date.now();
      const chatId = String(ctx.chatId || '');
      state.reminders = Array.isArray(state.reminders) ? state.reminders : [];
      const mine = state.reminders.filter((row) => String(row.chatId) === chatId);
      const ahead = upcoming(mine, now);

      const left = (at) => {
        const minutes = Math.max(1, Math.round((at - now) / 60_000));
        if (minutes < 60) return t(lang, 'ctrl.remind.inMin', { n: minutes });
        const hours = Math.round(minutes / 60);
        if (hours < 24) return t(lang, 'ctrl.remind.inHour', { n: hours });
        return t(lang, 'ctrl.remind.inDay', { n: Math.round(hours / 24) });
      };

      if (!input || input === 'list') {
        if (ahead.length === 0) {
          say([t(lang, 'ctrl.remind.title'), t(lang, 'ctrl.remind.empty'), t(lang, 'ctrl.remind.hint')].join('\n'));
          return true;
        }
        const lines = [t(lang, 'ctrl.remind.title')];
        ahead.forEach((row, index) => {
          lines.push(t(lang, 'ctrl.remind.line', {
            n: index + 1,
            when: stampAt(row.at, now),
            left: left(row.at),
            text: row.text,
          }));
        });
        lines.push(t(lang, 'ctrl.remind.hint'));
        say(lines.join('\n'));
        return true;
      }

      const [verb = ''] = input.split(/\s+/);
      if (/^(del|delete|rm|удали|удалить)$/i.test(verb)) {
        const index = Number.parseInt(input.split(/\s+/)[1], 10);
        if (!Number.isInteger(index) || index < 1 || index > ahead.length) {
          say(t(lang, 'ctrl.remind.delUsage'));
          return true;
        }
        const target = ahead[index - 1];
        state.reminders = state.reminders.filter((row) => row.id !== target.id);
        ctx.saveState();
        say(t(lang, 'ctrl.remind.delDone', { n: index, text: target.text }));
        return true;
      }
      if (/^(clear|очисти|очистить)$/i.test(verb)) {
        const ids = new Set(mine.map((row) => row.id));
        state.reminders = state.reminders.filter((row) => !ids.has(row.id));
        ctx.saveState();
        say(t(lang, 'ctrl.remind.cleared', { n: ids.size }));
        return true;
      }

      const parsed = parseReminder(input, now);
      if (parsed.error) {
        say(t(lang, `ctrl.remind.${parsed.error}`) + `\n${t(lang, 'ctrl.remind.hint')}`);
        return true;
      }
      if (mine.length >= 20) {
        say(t(lang, 'ctrl.remind.tooMany'));
        return true;
      }
      state.reminders.push({
        id: `r${now.toString(36)}${state.reminders.length}`,
        chatId,
        threadId: ctx.threadId || 0,
        key,
        at: parsed.at,
        text: parsed.text,
        lang: lang,
        madeAt: now,
      });
      ctx.saveState();
      say(t(lang, 'ctrl.remind.added', { when: stampAt(parsed.at, now), text: parsed.text }));
      return true;
    }
    default:
      return false;
  }
}
