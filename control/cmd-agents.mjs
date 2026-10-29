// How the agent works: subagents, effort, permissions, presets and the plan mode.
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
import { effectivePreset, setPermission } from '../permission-rows.mjs';
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
import { updatePolicy, bridgeRoot, copyRelease, installRelease, bridgeVersion, newestModuleMtime, npmLatest, npmLatestAsync } from './release.mjs';

export async function handleAgentCommands(ctx) {
  const { command, arg, send, reply, log, profile, state, key, config, lang: rawLang } = ctx;
  // The topic's language, then the config default, then English. Never Russian:
  // a group that has no opinion still must not guess a language.
  const lang = normalizeLang(rawLang) || normalizeLang(config?.lang) || 'en';
  const say = (text, extra) => (extra ? reply(text, extra) : reply(text));
  const activeProfile = profile || config.profile || 'headless';
  const effective = ctx.effective || command;
  switch (effective) {
    case '/agents': {
      // The desktop sidebar has a subagent list and a settings page; Telegram
      // gets the same two facts in one card: what this profile hands the model
      // as delegation tools, and which children this session actually started.
      const profileName = state.profiles?.[key] || activeProfile;
      const { rows, selection } = agentsOf(profileName);
      const head = modelOf(profileName);
      const fleet = fleetOf(state.sessions?.[key]);
      const wanted = String(arg || '').trim();

      if (wanted === 'set' || wanted.startsWith('set ')) {
        // The desktop settings page writes these rows; a person away from the
        // desk needs the same three knobs that decide what a child costs:
        // its model, how deep it may delegate, and which tools it may not use.
        const [, knob = '', ...rest] = wanted.split(/\s+/);
        let target = rest.join(' ').trim();
        // The row is named with `@`, not by a bare last word: "subagent" is also
        // a legitimate tool-filter entry, so a trailing bare name would make
        // `/agents set filter workflow,subagent` mean something else.
        const at = /(^|\s)@([\w.-]+)$/.exec(target);
        if (at && !rows.some((row) => row.toolName === at[2])) {
          say(t(lang, 'ctrl.agents.setNoRow', {
            tool: at[2],
            list: rows.map((row) => `@${row.toolName}`).join(', ') || '—',
          }));
          return true;
        }
        const only = at ? at[2] : '';
        if (only) target = target.slice(0, at.index).trim();
        const match = only
          ? (row) => new RegExp(`toolName:\\s*['"]?${only.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*(\\n|$)`).test(row.text)
          : undefined;
        const write = (path, next) => setRowConfig(read(patchPath(profileName)), {
          pkg: '@deepseek-ai/dsh-tool-subagent', path, value: next, match,
        });
        const done = (next) => {
          if (!next) {
            // Removing a key that is not there, or writing the value that is
            // already set: the profile is already in the asked-for state.
            say(t(lang, 'ctrl.agents.setSame'));
            return true;
          }
          writePatch(profileName, next);
          const after = agentsOf(profileName).rows;
          const line = after.map((row) => t(lang, 'ctrl.agents.setLine', {
            tool: row.toolName,
            model: row.model || t(lang, 'ctrl.agents.hostModel'),
            depth: row.maxDepth || t(lang, 'ctrl.agents.hostDepth'),
            deny: row.toolDeny,
          })).join('\n');
          say([t(lang, 'ctrl.agents.setDone', { name: profileName }), line].join('\n'));
          return true;
        };

        if (knob === 'model') {
          if (!target) { say(t(lang, 'ctrl.agents.setUsage')); return true; }
          const ids = modelsOf(profileName);
          if (ids.length > 0 && !ids.includes(target)) {
            say(t(lang, 'ctrl.agents.setUnknownModel', { model: target, list: ids.join(', ') }));
            return true;
          }
          return done(write(['agentOptions', 'model'], target));
        }
        if (knob === 'depth') {
          if (!target) { say(t(lang, 'ctrl.agents.setUsage')); return true; }
          if (target === 'default' || target === 'host') {
            return done(unsetRowConfig(read(patchPath(profileName)), {
              pkg: '@deepseek-ai/dsh-tool-subagent', path: ['maxDepth'], match,
            }));
          }
          if (!/^\d+$/.test(target) || Number(target) < 1 || Number(target) > 10) {
            say(t(lang, 'ctrl.agents.setBadDepth'));
            return true;
          }
          return done(write(['maxDepth'], Number(target)));
        }
        if (knob === 'filter') {
          if (!target) { say(t(lang, 'ctrl.agents.setUsage')); return true; }
          if (target === 'none' || target === 'off') {
            return done(unsetRowConfig(read(patchPath(profileName)), {
              pkg: '@deepseek-ai/dsh-tool-subagent', path: ['toolFilter'], match,
            }));
          }
          const denied = target.split(',').map((name) => name.trim()).filter(Boolean);
          if (denied.length === 0) { say(t(lang, 'ctrl.agents.setUsage')); return true; }
          return done(write(['toolFilter', 'deny'], denied));
        }
        say(t(lang, 'ctrl.agents.setUsage'));
        return true;
      }

      if (wanted) {
        const needle = wanted.replace(/^session-/, '').toLowerCase();
        const child = fleet.children.find((row) => row.id.replace(/^session-/, '').toLowerCase().startsWith(needle)
          || row.label.toLowerCase().includes(wanted.toLowerCase()));
        if (!child) {
          say(t(lang, 'ctrl.agents.notFound', { id: wanted }));
          return true;
        }
        say([
          t(lang, 'ctrl.agents.oneTitle', { id: child.id }),
          t(lang, 'ctrl.agents.oneName', { label: child.label || '—' }),
          t(lang, 'ctrl.agents.oneMode', { mode: child.mode || '—' }),
          t(lang, 'ctrl.agents.oneCreated', { when: stamp(child.at) }),
          '',
          t(lang, 'ctrl.agents.resume', { id: child.id }),
        ].join('\n'));
        return true;
      }

      const lines = [
        t(lang, 'ctrl.agents.title'),
        // Every number below answers a question someone actually asked looking
        // at the old dump: what is a "route", what does "depth" mean, who are
        // these children. The card says it in order — who does the work, what a
        // child may do, which models it may use, whose sessions came from here —
        // and each block ends with the one command that changes it.
        t(lang, 'ctrl.agents.lead'),
        '',
        t(lang, 'ctrl.agents.profile', { name: profileName, route: `${head.provider}/${head.model}` }),
        rows.length > 0
          ? t(lang, 'ctrl.agents.tools', { n: rows.length })
          : t(lang, 'ctrl.agents.toolsNone'),
      ];
      for (const row of rows) {
        lines.push(row.model
          ? `  • ${row.toolName} — ${row.provider}, ${row.modelProvider ? `${row.modelProvider}/` : ''}${row.model}`
          : t(lang, 'ctrl.agents.rowNoModel', { tool: row.toolName, provider: row.provider }));
        const filter = row.toolAllow + row.toolDeny > 0
          ? t(lang, 'ctrl.agents.filterList', { allow: row.toolAllow, deny: row.toolDeny })
          : t(lang, 'ctrl.agents.filterNone');
        lines.push(t(lang, 'ctrl.agents.detail', {
          depth: row.maxDepth || t(lang, 'ctrl.agents.hostDepth'),
          bg: row.background ? t(lang, 'ctrl.status.on') : t(lang, 'ctrl.status.off'),
          filter,
        }));
      }
      if (rows.length > 0) {
        lines.push(
          t(lang, 'ctrl.agents.depthHint', { sample: rows[0].toolName }),
          t(lang, 'ctrl.agents.filterHint', { sample: rows[0].toolName }),
        );
      }
      if (selection && selection.allowed.length > 0) {
        lines.push('', t(lang, 'ctrl.agents.routes', { n: selection.allowed.length }));
        for (const route of selection.allowed) lines.push(`  • ${route.provider}/${route.model}`);
        lines.push(t(lang, 'ctrl.agents.routesHint'));
      }
      lines.push('', t(lang, 'ctrl.agents.children', { n: fleet.children.length }));
      if (fleet.children.length === 0) {
        lines.push(t(lang, 'ctrl.agents.noChildren'));
      } else {
        for (const child of fleet.children.slice(0, 8)) {
          lines.push(t(lang, 'ctrl.agents.childLine', {
            label: (child.label || t(lang, 'ctrl.sessions.untitled')).slice(0, 40),
            mode: child.mode || '—',
            when: stamp(child.at),
          }));
        }
        if (fleet.children.length > 8) lines.push(`  … +${fleet.children.length - 8}`);
        lines.push(t(lang, 'ctrl.agents.childHint', { id: fleet.children[0].id }));
      }
      lines.push('', t(lang, 'ctrl.agents.hint'));
      say(lines.join('\n'));
      return true;
    }
    case '/effort': {
      // Reasoning effort is a provider-owned id on the default model. The route
      // declares which ones it accepts, so the card offers exactly those.
      const head = modelOf(activeProfile);
      const efforts = parseReasoningEfforts(read(patchPath(activeProfile)), head.model);
      const current = (() => {
        const block = /- id: agent-default-model[\s\S]*?(?=\n- id:|\n- insert:|$)/.exec(read(patchPath(activeProfile)));
        const hit = block && /^\s+reasoningEffort:\s*(\S+)/m.exec(block[0]);
        return hit ? hit[1] : '';
      })();
      const wanted = String(arg || '').trim().toLowerCase();
      if (!wanted) {
        say([
          t(lang, 'ctrl.effort.title', { route: `${head.provider}/${head.model}` }),
          current ? t(lang, 'ctrl.effort.current', { value: current }) : t(lang, 'ctrl.effort.unset'),
          efforts.length ? t(lang, 'ctrl.effort.options', { list: efforts.join(', ') }) : t(lang, 'ctrl.effort.noOptions'),
          t(lang, 'ctrl.effort.hint'),
        ].join('\n'));
        return true;
      }
      if (wanted === 'off' || wanted === 'none' || wanted === 'default') {
        const next = unsetRowConfig(read(patchPath(activeProfile)), {
          pkg: '@deepseek-ai/dsh-agent-default-model', path: ['reasoningEffort'],
        });
        say(next ? (writePatch(activeProfile, next), t(lang, 'ctrl.effort.cleared')) : t(lang, 'ctrl.effort.already'));
        return true;
      }
      if (efforts.length > 0 && !efforts.includes(wanted)) {
        say(t(lang, 'ctrl.effort.unknown', { value: wanted, list: efforts.join(', ') }));
        return true;
      }
      const next = setRowConfig(read(patchPath(activeProfile)), {
        pkg: '@deepseek-ai/dsh-agent-default-model', path: ['reasoningEffort'], value: wanted,
      });
      if (!next) { say(t(lang, 'ctrl.effort.already')); return true; }
      writePatch(activeProfile, next);
      // With no catalog there is nothing to validate against, and refusing every
      // value would make the knob useless on such a route. Write it, but say
      // plainly that nobody promised the provider accepts it.
      say(efforts.length > 0
        ? t(lang, 'ctrl.effort.set', { value: wanted, name: activeProfile })
        : t(lang, 'ctrl.effort.blind', { value: wanted, name: activeProfile }));
      return true;
    }
    case '/permissions': {
      // Sandbox and approval policy decide what a turn may touch. The desktop
      // shows them as a preset picker; here they are two profile rows, and the
      // *effective* preset is what `defaultPreset` names — not the first row of
      // the table, which happens to agree only because nobody edits by hand.
      //
      // A topic bound to an agent set already runs under a profile of its own
      // (`aset-profile.mjs`), so there the choice belongs to the set: it moves
      // this topic and leaves every other topic where it was. An unbound topic
      // has no such profile, so the write is profile-wide — and says so.
      const boundId = state.agentsets?.[key] || '';
      const boundSet = boundId ? agentset().get(boundId) : null;
      const text = read(patchPath(activeProfile));
      const table = parsePermissionPresets(text);
      if (!table) {
        say(t(lang, 'ctrl.perm.none', { name: activeProfile }));
        return true;
      }
      const current = effectivePreset(text);
      const currentId = boundSet
        ? String(boundSet.permissions || current?.id || '')
        : current?.from === 'unknown' ? '' : current?.id || '';
      const wanted = String(arg || '').trim();
      if (!wanted) {
        const lines = [t(lang, 'ctrl.perm.title', { name: activeProfile })];
        if (boundSet) lines.push(t(lang, 'ctrl.perm.topicTitle', { name: boundSet.name || boundSet.id }));
        if (currentId) lines.push(t(lang, 'ctrl.perm.current', { name: currentId }));
        else if (current?.from === 'unknown') lines.push(t(lang, 'ctrl.perm.broken', { name: current.id }));
        else lines.push(t(lang, 'ctrl.perm.noCurrent'));
        for (const preset of table.presets) {
          const mark = preset.id === currentId ? '*' : ' ';
          // A chat has no approval channel: `ask` fails closed at spawn, so the
          // preset is listed with the reason instead of looking selectable.
          const note = preset.approval === 'ask' ? t(lang, 'ctrl.perm.needsApproval') : '';
          lines.push(`  ${mark} ${preset.id}${preset.sandbox ? ` — ${preset.sandbox}, ${preset.approval || '?'}` : ''}${note}`);
        }
        if (table.presets.length === 0) lines.push(t(lang, 'ctrl.perm.noPresets'));
        lines.push(t(lang, boundSet ? 'ctrl.perm.hintTopic' : 'ctrl.perm.hint'));
        say(lines.join('\n'));
        return true;
      }
      const chosen = table.presets.find((preset) => preset.id === wanted);
      if (!chosen) {
        say(t(lang, 'ctrl.perm.unknown', {
          name: wanted,
          list: table.presets.map((preset) => preset.id).join(', '),
        }));
        return true;
      }
      if (chosen.approval === 'ask') {
        say(t(lang, 'ctrl.perm.cannotAsk', { name: wanted }));
        return true;
      }
      if (wanted === currentId) {
        say(t(lang, 'ctrl.perm.already', { name: wanted }));
        return true;
      }
      if (boundSet) {
        const result = agentset().put({ ...boundSet, permissions: wanted });
        if (!result.ok) {
          say(t(lang, 'ctrl.set.failed', { error: result.error || '?' }));
          return true;
        }
        ctx.saveState();
        say(t(lang, 'ctrl.perm.setTopic', { name: wanted, set: boundSet.name || boundSet.id }));
        return true;
      }
      // One writer for both rows: the preset and the sandbox mode it stands for.
      const next = setPermission(text, { preset: wanted });
      if (!next || next === text) { say(t(lang, 'ctrl.perm.already', { name: wanted })); return true; }
      writePatch(activeProfile, next);
      say(t(lang, 'ctrl.perm.set', { name: wanted, profile: activeProfile }));
      return true;
    }
    case '/preset': {
      // A preset is a composition (persona, instructions, tools); a profile can
      // carry several and a registry row picks the default one. A profile may
      // declare presets and no registry row — the desktop app then owns the
      // choice, and this card must not invent one.
      const text = read(patchPath(activeProfile));
      const { presets, selected } = parseAgentPresets(text);
      const pinned = selected !== '' || /@deepseek-ai\/dsh-agent-preset-registry/.test(text);
      const wanted = String(arg || '').trim();
      if (presets.length === 0) {
        say(t(lang, 'ctrl.preset.none', { name: activeProfile }));
        return true;
      }
      if (!wanted) {
        const active = selected;
        const lines = [t(lang, 'ctrl.preset.title', { name: activeProfile })];
        for (const preset of presets) {
          lines.push(`  ${preset.id === active ? '*' : ' '} ${preset.id}`);
        }
        if (!active) lines.push(t(lang, 'ctrl.preset.unpinned', { name: activeProfile }));
        lines.push(t(lang, 'ctrl.preset.hint'));
        say(lines.join('\n'));
        return true;
      }
      if (!presets.some((preset) => preset.id === wanted)) {
        say(t(lang, 'ctrl.preset.unknown', {
          name: wanted,
          list: presets.map((preset) => preset.id).join(', '),
        }));
        return true;
      }
      if (!pinned) {
        say(t(lang, 'ctrl.preset.unpinned', { name: activeProfile }));
        return true;
      }
      const next = setRowConfig(text, {
        pkg: '@deepseek-ai/dsh-agent-preset-registry', path: ['selectedDefault'], value: wanted,
      });
      if (!next) { say(t(lang, 'ctrl.preset.already', { name: wanted })); return true; }
      writePatch(activeProfile, next);
      say(t(lang, 'ctrl.preset.set', { name: wanted, profile: activeProfile }));
      return true;
    }
    case '/plan': {
      // Plan mode is a session-log switch the host writes, so a Telegram turn
      // cannot flip it. What this card can do is tell the truth about the state
      // and give the one instruction that produces a plan without changes.
      const fleet = fleetOf(state.sessions?.[key]);
      const lines = [t(lang, 'ctrl.plan.title', { name: activeProfile })];
      if (!fleet.plan) {
        lines.push(t(lang, 'ctrl.plan.unknown'));
      } else {
        lines.push(t(lang, 'ctrl.plan.state', {
          state: fleet.plan.active ? t(lang, 'ctrl.status.on') : t(lang, 'ctrl.status.off'),
        }));
        if (fleet.plan.pending) lines.push(t(lang, 'ctrl.plan.pending'));
      }
      lines.push(t(lang, 'ctrl.plan.how'));
      say(lines.join('\n'));
      return true;
    }
    default:
      return false;
  }
}
