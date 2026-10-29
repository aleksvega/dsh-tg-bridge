// The bridge itself: restart, update, version, doctor, logs, stop, send.
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
import { chainSummary } from '../fallback-card.mjs';
import { explainCommand } from '../help-explain.mjs';
import { profileValues, resolveSettings } from '../settings.mjs';
import { UPDATE_DEFAULTS, describeUpdate, modeChange, updateState } from '../update-policy.mjs';
import { isNewer, pluginInfo, rowLine, searchPlugins } from '../plugin-search.mjs';
import { COMMAND_ALIASES, CONTROL_COMMANDS, DOCUMENTED_COMMANDS } from '../commands-registry.mjs';
import { APP, CLI_JS, DSH_CMD, DSH_HOME, DIR, EXE, HOME, LOG, PROFILES, THOUGHT_DIR } from '../paths.mjs';
import { read, readJson, patchPath, pkgPath, OVERLAY_MARK, modelsOf, modelOf, windowOf, modelIndent, depthOf, modelsReport, setModel, disabledIds, setDisabled, writePatch } from './models.mjs';
import { listPids, waitForExit, waitForStart, pluginsOf, bundleRowIds, addBundle, removeBundle, createProfile, dshPlugin } from './plugins.mjs';
import { cwdSlug, bareId, stamp, recentSessions, sessionTitle } from './sessions.mjs';
import { agentsOf, fleetOf, patchRows, skillsOf, AGENTS, PERSONA_HEADING, soulOf, setSoul } from './agents.mjs';
import { fmt, AGENTSETS, agentset, agentsetOf, profileRowOf, bindAgentset, agentsetCard, agentsetKeyboard } from './agentsets.mjs';
import { taskKeyboard, goalView, taskView, filterLogLines } from './tasks.mjs';
import { updatePolicy, bridgeRoot, copyRelease, installRelease, bridgeVersion, newestModuleMtime, npmLatest, npmLatestAsync } from './release.mjs';
import { buildReport, tailOf, writeReport } from '../report.mjs';
import { effectivePreset } from '../permission-rows.mjs';

/**
 * Which bridge is running, which one npm has, and whether this install can
 * update itself. A report, so it answers even in the middle of a turn.
 *
 * It lives in a function because `/update` without an argument now opens with
 * the same lines: "am I current?" used to be two commands and two messages.
 */
function versionCard(lang) {
  const installed = bridgeVersion();
  const latest = npmLatest('dsh-tg-bridge');
  const where = process.env.DSH_BRIDGE_ROOT || join(DSH_HOME, 'tg-bridge');
  const lines = [t(lang, 'ctrl.version.title')];
  lines.push(t(lang, 'ctrl.version.installed', { v: installed || t(lang, 'ctrl.version.unknown') }));
  lines.push(t(lang, 'ctrl.version.latest', { v: latest || t(lang, 'ctrl.version.offline') }));
  if (installed && latest && installed !== latest) lines.push(t(lang, 'ctrl.version.update', { v: latest }));
  lines.push(t(lang, 'ctrl.version.root', { path: where }));
  lines.push(t(lang, 'ctrl.version.hint'));
  // The number above comes from package.json on disk; the code actually
  // answering this came from the files as they were at process start. When
  // ./sync-runtime.mjs (or /update) has since replaced them, saying so beats a
  // version that reads as live while it is not.
  const started = Date.now() - process.uptime() * 1000;
  const newest = newestModuleMtime(where);
  if (newest && newest > started + 2000) {
    lines.push(t(lang, 'ctrl.version.stale', { when: stamp(newest) }));
  }
  return lines.join('\n');
}

export async function handleBridgeCommands(ctx) {
  const { command, arg, send, reply, log, profile, state, key, config, chatId, threadId, lang: rawLang, saveState } = ctx;
  // The topic's language, then the config default, then English. Never Russian:
  // a group that has no opinion still must not guess a language.
  const lang = normalizeLang(rawLang) || normalizeLang(config?.lang) || 'en';
  const say = (text, extra) => (extra ? reply(text, extra) : reply(text));
  const activeProfile = profile || config.profile || 'headless';
  const effective = ctx.effective || command;
  switch (effective) {
    case '/restart': {
      if (arg !== 'confirm') {
        say(t(lang, 'cmd.restart.prompt'));
        return true;
      }
      say(t(lang, 'cmd.restart.started'));
      const bridge = fileURLToPath(new URL('./bridge.mjs', import.meta.url));
      // Tell the replacement process where to confirm, so the chat does not go
      // silent after "Перезапускаю мост…" (it did, twice on 2026-10-24).
      try {
        writeFileSync(
          fileURLToPath(new URL('./restart-notice.json', import.meta.url)),
          JSON.stringify({ chatId: ctx.chatId, threadId: ctx.threadId || 0, at: Date.now() }),
          'utf8',
        );
      } catch (error) {
        log(`restart notice not written: ${error.message}`);
      }
      spawn(process.execPath, [bridge], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      setTimeout(() => process.exit(0), 300);
      return true;
    }
    case '/app': {
      if (!/^restart\b/.test(arg || '')) {
        say(t(lang, 'ctrl.app.usage'));
        return true;
      }
      if (arg !== 'restart confirm') {
        say(t(lang, 'ctrl.app.confirm'));
        return true;
      }
      // Report the real outcome, not just "restarting": the old version fired
      // taskkill by image name and never checked whether the process survived,
      // so a no-op looked identical to success.
      const before = listPids();
      if (before.length === 0) {
        say(t(lang, 'ctrl.app.notRunning'));
        spawn(EXE, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
        setTimeout(() => {
          const after = listPids();
          say(after.length
            ? t(lang, 'ctrl.app.started', { pids: after.join(', ') })
            : t(lang, 'ctrl.app.startFailed'));
        }, 15000);
        return true;
      }
      say(t(lang, 'ctrl.app.restarting', { pids: before.join(', '), exe: EXE }));
      spawn('taskkill', ['/IM', 'DeepSeek Harness.exe', '/T', '/F'], { windowsHide: true, detached: true }).on('close', async () => {
        const gone = await waitForExit(before, 12000);
        if (!gone) {
          say(t(lang, 'ctrl.app.stuck'));
          return;
        }
        if (!existsSync(EXE)) {
          say(t(lang, 'ctrl.app.noExe', { exe: EXE }));
          return;
        }
        spawn(EXE, [], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
        const up = await waitForStart(15000);
        say(up.length
          ? t(lang, 'ctrl.app.restarted', { pids: up.join(', ') })
          : t(lang, 'ctrl.app.notUp'));
      });
      return true;
    }
    case '/stop': {
      const killed = ctx.stopTurn ? ctx.stopTurn(key) : false;
      say(killed ? t(lang, 'cmd.stop.killed') : t(lang, 'cmd.stop.nothing'));
      return true;
    }
    case '/send': {
      // `/send <path>` uploads a local file into this topic. Without it the
      // agent could only talk about artifacts, never deliver them.
      const path = (arg || '').trim().replace(/^"|"$/g, '');
      if (!path) { say(t(lang, 'ctrl.send.usage')); return true; }
      if (!ctx.sendFile) { say(t(lang, 'ctrl.send.unsupported')); return true; }
      try {
        await ctx.sendFile(path, basename(path));
        return true;
      } catch (error) {
        say(t(lang, 'ctrl.send.failed', { err: error.message }));
        return true;
      }
    }
    case '/doctor': {
      // One command that answers "why is it broken?" instead of a conversation.
      const rows = [];
      const add = (label, value) => rows.push(`${label}: ${value}`);

      // Bridge process + pid file.
      let pid = 0;
      try {
        pid = Number(readFileSync(join(DSH_HOME, 'tg-bridge', 'bridge.pid'), 'utf8').trim());
      } catch {}
      add(t(lang, 'ctrl.doctor.bridgePid'), pid || t(lang, 'ctrl.doctor.noPidFile'));
      if (pid) {
        try {
          process.kill(pid, 0);
          add(t(lang, 'ctrl.doctor.bridgeAlive'), t(lang, 'ctrl.doctor.yes'));
        } catch (error) {
          add(t(lang, 'ctrl.doctor.bridgeAlive'), t(lang, error.code === 'EPERM' ? 'ctrl.doctor.yesEperm' : 'ctrl.doctor.no'));
        }
      }

      // Telegram reachability + bot identity.
      try {
        const me = await ctx.api?.('getMe');
        add(t(lang, 'ctrl.doctor.telegram'), me?.username ? `ok @${me.username}` : t(lang, 'ctrl.doctor.telegramOk'));
      } catch (error) {
        add(t(lang, 'ctrl.doctor.telegram'), t(lang, 'ctrl.doctor.telegramError', { err: error.message }));
      }

      // Conflicts and network errors SINCE THE CURRENT PROCESS STARTED.
      //
      // Counting the last N lines of the whole file reported 39 conflicts and
      // 84 network errors while the running bridge had none: those lines
      // belonged to earlier processes. A diagnostic that cries wolf is worse
      // than no diagnostic, so the window starts at the last "bridge started".
      try {
        const lines = readFileSync(join(DSH_HOME, 'tg-bridge', 'bridge.log'), 'utf8').split(/\r?\n/).filter(Boolean);
        let start = 0;
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          if (lines[i].includes('bridge started')) {
            start = i;
            break;
          }
        }
        const since = lines.slice(start).join('\n');
        const conflicts = (since.match(/409|Conflict: terminated/g) ?? []).length;
        const net = (since.match(/poll error|fetch failed|TG_NET/g) ?? []).length;
        add(t(lang, 'ctrl.doctor.conflicts'), String(conflicts));
        add(t(lang, 'ctrl.doctor.netErrors'), String(net));
        add(t(lang, 'ctrl.doctor.logLines'), String(lines.length - start));
      } catch {}

      // Disk space: the silent killer of model downloads and OCR.
      try {
        const drives = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(Get-PSDrive C).Free'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 15000,
        });
        const free = Number(drives) || 0;
        add(t(lang, 'ctrl.doctor.disk'), t(lang, 'ctrl.doctor.diskFree', { gb: (free / 1024 ** 3).toFixed(1) }));
      } catch {}

      // Project directory bound to this topic and whether it exists. The bridge
      // default is a fact, not an accident: say when it is being used.
      const bound = state.cwd && state.cwd[key];
      const cwd = bound || config.cwd || '';
      const shown = cwd
        ? `${cwd}${bound ? '' : t(lang, 'ctrl.doctor.cwdDefault')}${existsSync(cwd) ? '' : t(lang, 'ctrl.doctor.cwdMissing')}`
        : t(lang, 'ctrl.doctor.cwdUnset');
      add(t(lang, 'ctrl.doctor.cwd'), shown);

      add(t(lang, 'ctrl.doctor.session'), state.sessions[key] || t(lang, 'ctrl.doctor.sessionNew'));
      say(`${t(lang, 'ctrl.doctor.title')}\n\n${rows.join('\n')}`);
      return true;
    }
    case '/logs': {
      // `/logs` — meaningful events, `/logs 100` — more, `/logs <text>` —
      // filter, `/logs errors` — failures only, `/logs file` — the whole file
      // as a document, when the answer needs the part chat cannot hold.
      const file = join(DSH_HOME, 'tg-bridge', 'bridge.log');
      const wanted = (arg || '').trim();
      if (/^(file|full|all|файл|файлом|全文|文件)$/i.test(wanted)) {
        if (!ctx.sendFile) {
          say(t(lang, 'ctrl.logs.noFileChannel'));
          return true;
        }
        try {
          await ctx.sendFile(file, t(lang, 'ctrl.logs.fileCaption', {
            mb: (statSync(file).size / 1024 ** 2).toFixed(1),
          }));
        } catch (error) {
          say(t(lang, 'ctrl.logs.unreadable', { err: error.message }));
        }
        return true;
      }
      let lines = [];
      try {
        lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
      } catch (error) {
        say(t(lang, 'ctrl.logs.unreadable', { err: error.message }));
        return true;
      }
      const numeric = Number(arg);
      const count = Number.isInteger(numeric) && numeric > 0 ? Math.min(numeric, 200) : 30;
      const filter = Number.isInteger(numeric) ? '' : (arg || '').trim();
      const { pool, tail } = filterLogLines(lines, filter, count);

      if (pool.length === 0) {
        say(filter ? t(lang, 'ctrl.logs.noMatch', { filter }) : t(lang, 'ctrl.logs.empty'));
        return true;
      }
      const header = filter === 'errors'
        ? t(lang, 'ctrl.logs.errors', { shown: tail.length, total: pool.length })
        : t(lang, 'ctrl.logs.title', { shown: tail.length, total: pool.length });
      say(`${header}\n\n${tail.join('\n')}`);
      return true;
    }
    case '/version': {
      // Kept as the body `/update` uses: the old spelling is rewritten to
      // `/update` before dispatch, so this only answers if something calls it
      // directly. One card, one source of the numbers.
      say(versionCard(lang));
      return true;
    }
    case '/update': {
      // The person's own copy of the bridge, updated from npm. Nothing is
      // touched unless the release is newer, and the running process keeps its
      // old modules until the next `/restart confirm` — so a bad release never
      // takes the chat down by itself.
      const policy = updatePolicy(state);
      const installed = bridgeVersion();
      const latest = npmLatest('dsh-tg-bridge');
      const sub = String(arg).trim().toLowerCase();
      if (['on', 'off', 'check', 'auto', 'manual'].includes(sub)) {
        const change = modeChange({ installed, latest, command: sub });
        if (change.store) {
          // A switch answers about the switch itself: no "1.14.0 is out" on the
          // next check for a release the person was just told about.
          Object.assign(policy, change.store, latest ? { notified: latest } : {});
          saveState();
        }
        say(change.text);
        return true;
      }
      if (sub === 'confirm') {
        if (!latest) {
          say(t(lang, 'ctrl.update.offline'));
          return true;
        }
        if (installed && installed === latest) {
          say(t(lang, 'ctrl.update.current', { v: installed }));
          return true;
        }
        say(t(lang, 'ctrl.update.running', { v: latest }));
        let backup = '';
        try {
          backup = installRelease(latest);
        } catch (error) {
          say(t(lang, 'ctrl.update.failed', { code: 'npm' }) + `\n\n${String(error.message).slice(-700)}`);
          return true;
        }
        // The files on disk are the new ones now; this process still runs the
        // old code, so the way back is one folder name.
        policy.notified = latest;
        saveState();
        say(t(lang, 'ctrl.update.done', { v: latest }) + `\n${t(lang, 'ctrl.update.backup', { path: join(bridgeRoot(), backup) })}`);
        return true;
      }
      // No argument: which bridge is running and where this install stands.
      // This used to be two commands (`/version` for the numbers, `/update` for
      // the state), which meant "am I current?" took two messages. One card
      // answers both, and `/version` still arrives here rewritten.
      say(versionCard(lang) + '\n\n' + describeUpdate(updateState({ installed, latest, mode: policy.mode, notified: policy.notified })));
      return true;
    }
    case '/report': {
      // A bug report assembled from what the bridge already knows, so "it broke"
      // does not need five follow-up questions. It is redacted before it leaves
      // (`report.mjs`), and it goes to the owner's own id: in a group the answer
      // is the path on this machine, because the log tail is not group material.
      const owner = Number(config.allowedUserIds?.[0]) || 0;
      const toOwner = Boolean(owner) && Number(chatId) === owner && !Number(threadId);
      const patchText = read(patchPath(activeProfile));
      const preset = effectivePreset(patchText)?.id || '';
      // The same renderer the card uses: a report that counted routes a turn
      // would skip is the report that hides the bug it was opened for.
      const entries = Array.isArray(config.fallbackModels) ? config.fallbackModels : [];
      const chain = chainSummary(entries, { t: (k, v) => t(lang, k, v) });
      const failure = state.lastFailure?.[key]?.error || '';
      const text = buildReport({
        version: bridgeVersion(),
        profile: activeProfile,
        preset,
        model: modelOf(activeProfile).model,
        chain,
        cwd: state.cwd?.[key] || config.cwd || '',
        failure,
        log: tailOf(LOG, 120),
        home: HOME,
        ids: [chatId, threadId, ...(config.allowedUserIds || [])],
        note: String(arg || '').trim(),
      });
      const path = writeReport(text, join(DIR, 'reports'));
      if (!path) {
        say(t(lang, 'ctrl.report.failed'));
        return true;
      }
      if (toOwner && ctx.sendFile) {
        try {
          await ctx.sendFile(path, t(lang, 'ctrl.report.caption', { v: bridgeVersion() || '?' }));
          return true;
        } catch (error) {
          say(t(lang, 'ctrl.report.sendFailed', { err: error.message, path }));
          return true;
        }
      }
      say(t(lang, 'ctrl.report.pathOnly', { path }));
      return true;
    }
    default:
      return false;
  }
}
