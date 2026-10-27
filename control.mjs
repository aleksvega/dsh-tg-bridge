// dsh-telegram-bridge — control plane.
//
// The command surface that makes DSH manageable from Telegram with no UI:
// profiles, model, sessions, plugins (extensions), skills, persona, restarts.
// Everything works on the same files DSH itself reads, so a running desktop app
// and a headless turn see the same state; commands that need a reload say so.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

const HOME = homedir();
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh');
const PROFILES = join(DSH_HOME, 'profiles');
/** Where a reasoning log is written before it is sent as a document. */
const THOUGHT_DIR = join(DSH_HOME, 'tg-bridge', 'thoughts');
const APP = join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness');
const EXE = join(APP, 'DeepSeek Harness.exe');
const DSH_CMD = join(APP, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
const CLI_JS = join(APP, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');

/** Live DSH app PIDs (empty when the app is not running). */
function listPids() {
  try {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/NH', '/FO', 'CSV'], {
      windowsHide: true,
      encoding: 'utf8',
    });
    return (r.stdout || '')
      .split(/\r?\n/)
      .map((line) => /^"DeepSeek Harness\.exe","(\d+)"/.exec(line.trim()))
      .filter(Boolean)
      .map((m) => Number(m[1]));
  } catch {
    return [];
  }
}

/** Poll until every listed pid is gone; true when they all exited. */
async function waitForExit(pids, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const alive = listPids();
    if (!pids.some((pid) => alive.includes(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** Poll until at least one DSH pid appears (new or old); returns them. */
async function waitForStart(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const alive = listPids();
    if (alive.length > 0) return alive;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return [];
}

const read = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};
const readJson = (path) => {
  try {
    return JSON.parse(read(path).replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
};
const patchPath = (profile) => join(PROFILES, profile, 'cordis.patch.yml');
const pkgPath = (profile) => join(PROFILES, profile, 'package.json');
// Written by `ensureProfile()` in profiles.mjs when it materialises a model
// overlay as a profile of its own.
const OVERLAY_MARK = ': per-turn model overlay ----';

/** Model ids declared under `llm-pi-ai.providers.<provider>.models` in a patch. */
function modelsOf(profile) {
  const text = read(patchPath(profile));
  const lines = text.split('\n');
  const ids = [];
  let inModels = false;
  for (const line of lines) {
    if (/^\s{8}models:\s*$/.test(line)) {
      inModels = true;
      continue;
    }
    if (inModels) {
      const match = /^\s{10}- id:\s*(\S+)/.exec(line);
      if (match) ids.push(match[1]);
      else if (/^\s{0,8}\S/.test(line) && line.trim() && !line.trim().startsWith('- id:')) inModels = false;
    }
  }
  return ids;
}

/** Current default model of a profile. */
function modelOf(profile) {
  const text = read(patchPath(profile));
  const block = /- id: agent-default-model[\s\S]*?(?=\n- id:|\n- insert:|$)/.exec(text);
  const model = block && /^\s+model:\s*(\S+)/m.exec(block[0]);
  const provider = block && /^\s+provider:\s*(\S+)/m.exec(block[0]);
  return { provider: provider ? provider[1] : '?', model: model ? model[1] : '?' };
}

/**
 * The context window this profile actually runs with.
 *
 * It lives in the profile's own patch — `defaultContextWindow`, and a
 * `contextWindow` per model that overrides it — never in the bridge config. The
 * old code looked only at config and told every install to fix a file that has
 * no such key, which read as "the bot does not know" when the bot was simply
 * asking the wrong place.
 *
 * A profile whose model has no explicit window is left to the model registry, so
 * the answer is empty rather than a guess: an invented denominator turns into a
 * wrong percentage.
 */
function windowOf(profile, model) {
  const lines = read(patchPath(profile)).split(/\r?\n/);

  // The provider's own default, which DSH writes as `defaultContextWindow`; a
  // bare `contextWindow` on the provider is the same thing spelled differently.
  // The provider key and a per-model key are told apart by indentation alone:
  // model rows sit two spaces deeper than the `- ` that starts them.
  const windowRows = lines
    .map((line) => /^(\s*)(?:defaultContextWindow|contextWindow):\s*(\d+)/.exec(line))
    .filter(Boolean);
  const fallback = Number((windowRows.find((row) => row[1].length < modelIndent(lines)) || [])[2] || 0);

  if (!model) return fallback;

  // A model entry is a YAML row whose `name` is the id, with `contextWindow` at
  // the same indentation a line or two below. Many entries, one match.
  const wanted = new RegExp(`^\\s*(?:-\\s+)?name:\\s*${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const nameAt = lines.findIndex((line) => wanted.test(line));
  if (nameAt < 0) return fallback;
  const indent = depthOf(lines[nameAt]);
  for (let i = nameAt + 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    const at = depthOf(lines[i]);
    if (at < indent) break;
    const own = /^\s*contextWindow:\s*(\d+)/.exec(lines[i]);
    if (own && at <= indent + 2) return Number(own[1]);
  }
  return fallback;
}

/**
 * The indentation a profile's model rows are written at.
 *
 * Read from the file rather than assumed: the first row of the list that the
 * provider default introduces sets it, and its keys sit two spaces deeper. A
 * profile with no list at all falls back to the shape every DSH profile has.
 */
function modelIndent(lines) {
  const at = lines.findIndex((line) => /^\s*defaultContextWindow:/.test(line));
  const from = at >= 0 ? at + 1 : 0;
  const row = lines.slice(from).find((line) => /^\s*-\s+(?:id|name):/.test(line));
  const spaces = row ? /^\s*/.exec(row)[0].length : 10;
  return spaces + 2;
}

/** Spaces of indentation a line starts with; the leaf row of a list reads one deeper. */
function depthOf(text) {
  const spaces = /^\s*/.exec(String(text))[0].length;
  return /^\s*-\s/.test(String(text)) ? spaces + 2 : spaces;
}

/** The `/model` list: what this profile runs and what else it could run. */
function modelsReport(lang, profile) {
  const head = modelOf(profile);
  const ids = modelsOf(profile);
  return [
    ids.length > 0
      ? t(lang, 'ctrl.models.current', { model: head.model })
      : t(lang, 'ctrl.models.none', { name: profile }),
    ...(ids.length > 0
      ? [t(lang, 'ctrl.models.available'), ...ids.map((id) => `  ${id === head.model ? '*' : ' '} ${id}`)]
      : []),
  ].join('\n');
}

/** Rewrite the default model of a profile; returns false for an unknown id. */
function setModel(profile, wanted) {
  const ids = modelsOf(profile);
  if (ids.length > 0 && !ids.includes(wanted)) return false;
  const path = patchPath(profile);
  const text = read(path);
  const re = /(- id: agent-default-model[\s\S]*?^\s+model:\s*)(\S+)/m;
  if (!re.test(text)) return false;
  writeFileSync(path, text.replace(re, `$1${wanted}`), 'utf8');
  return true;
}

/** Top-level patch entry ids that carry `disabled:` in a profile. */
function disabledIds(profile) {
  const text = read(patchPath(profile));
  const out = [];
  const entries = text.split(/\n(?=- )/);
  for (const entry of entries) {
    const id = /^- id:\s*(\S+)/.exec(entry);
    // Only a two-space indent is the entry's own key; deeper ones belong to the
    // nested plugin rows of a group entry and are not the entry being disabled.
    if (id && /^ {2}disabled:\s*true\s*$/m.test(entry)) out.push(id[1]);
  }
  return out;
}

/**
 * Enable or disable one loader row of a profile.
 * The patch is an ordered list where later entries win, so a disable is an
 * appended `- id: <id>\n  disabled: true`, and an enable removes that key from
 * the last entry mentioning the id.
 */
function setDisabled(profile, id, disabled) {
  const path = patchPath(profile);
  const text = read(path);
  const entries = text.split(/\n(?=- )/);
  const idx = entries.map((entry, i) => ({ entry, i })).filter(({ entry }) => new RegExp(`^- id:\\s*${id}\\s*$`, 'm').test(entry));
  if (idx.length === 0) return false;
  const last = idx[idx.length - 1];
  if (disabled) {
    if (/^\s+disabled:\s*true\s*$/m.test(last.entry)) return true;
    entries.push(`- id: ${id}\n  disabled: true`);
  } else {
    entries[last.i] = last.entry.replace(/^\s+disabled:\s*(true|false)\s*\n?/m, '');
  }
  writeFileSync(path, entries.join('\n'), 'utf8');
  return true;
}

/**
 * Replace a profile patch atomically, keeping the previous file as `.bak`.
 * A turn booting during the write must read either the old or the new file:
 * the patch decides what every later turn may do, and half a file is a profile
 * that fails to start.
 */
function writePatch(profile, text) {
  const path = patchPath(profile);
  try { copyFileSync(path, `${path}.bak`); } catch {}
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}

/** Installed packages plus the bundle list of a profile. */
function pluginsOf(profile) {
  const pkg = readJson(pkgPath(profile)) || {};
  const deps = Object.keys(pkg.dependencies || {});
  const bundles = ((pkg.dsh || {}).profile || {}).bundles || [];
  const disabled = disabledIds(profile);
  return { deps, bundles, disabled };
}

/**
 * Loader row ids a bundle installs, read from its own patch file.
 * A bundle package name (`@xmanrui/dsh-im`) is not the row id a profile patch
 * disables (`xmanrui-dsh-im`), so the mapping has to come from the patch.
 */
function bundleRowIds(profile, name) {
  const dir = join(PROFILES, profile, 'node_modules', name);
  const pkg = readJson(join(dir, 'package.json'));
  const patch = ((pkg || {}).dsh || {}).bundle?.patch || './cordis.patch.yml';
  const text = read(join(dir, patch.replace(/^\.\//, '')));
  const ids = [];
  for (const match of text.matchAll(/^\s*-?\s*id:\s*['"]?([A-Za-z0-9_.@/-]+)['"]?\s*$/gm)) ids.push(match[1]);
  return ids;
}

/** Add a bundle name to `dsh.profile.bundles` when it is not listed yet. */
function addBundle(profile, name) {
  const path = pkgPath(profile);
  const pkg = readJson(path);
  if (!pkg) return false;
  const profileBlock = (pkg.dsh = pkg.dsh || {}).profile || (pkg.dsh.profile = {});
  const bundles = profileBlock.bundles || (profileBlock.bundles = []);
  if (bundles.includes(name)) return false;
  bundles.push(name);
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  return true;
}

function removeBundle(profile, name) {
  const path = pkgPath(profile);
  const pkg = readJson(path);
  if (!pkg) return false;
  const bundles = ((pkg.dsh || {}).profile || {}).bundles || [];
  const next = bundles.filter((entry) => entry !== name);
  if (next.length === bundles.length) return false;
  pkg.dsh.profile.bundles = next;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  return true;
}

/** Run `dsh plugin ...` (which forwards to pnpm) and collect its output. */
/**
 * Create a profile from a shipped template, the same way the GUI does it:
 * `dsh <name> --from-default-profile <template>`. `--dump-config` stops right
 * after the profile tree is written, so nothing boots and no plugin is loaded.
 * Dependencies are installed on the profile's first turn.
 */
function createProfile(name, template, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const useExe = process.platform === 'win32' && existsSync(EXE) && existsSync(join(APP, 'resources', 'app.asar'));
    const args = [name, '--from-default-profile', template, '--dump-config'];
    const child = useExe
      ? spawn(EXE, ['--expose-internals', CLI_JS, ...args], {
          windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        })
      : spawn('dsh', args, { windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', () => {});
    const done = () => {
      clearTimeout(timer);
      resolve(existsSync(join(PROFILES, name, 'cordis.patch.yml')));
    };
    child.on('close', done);
    child.on('error', done);
  });
}

function dshPlugin(profile, args, timeoutMs = 180000) {
  return new Promise((resolve) => {
    // Spawning the .cmd shim with shell:false fails with EINVAL on modern Node.
    // Run the real CLI entry through the Electron binary instead, like the
    // bridge does for turns; fall back to a plain `dsh` on other platforms.
    const useExe = process.platform === 'win32' && existsSync(EXE) && existsSync(join(APP, 'resources', 'app.asar'));
    const child = useExe
      ? spawn(EXE, ['--expose-internals', CLI_JS, 'plugin', '--profile', profile, ...args], {
          windowsHide: true,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        })
      : spawn('dsh', ['plugin', '--profile', profile, ...args], { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (buf) => {
      out += buf;
    });
    child.stderr.on('data', (buf) => {
      out += buf;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out: out.trim() });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, out: error.message });
    });
  });
}

/** DSH's on-disk folder name for a workspace: `--C-Users-me-work--`. */
function cwdSlug(cwd) {
  const parts = String(cwd).replace(/[:\\/]+/g, '\\').split('\\').filter(Boolean);
  return `--${parts.join('-')}--`;
}

/** Session ids appear both bare and as `session-<uuid>`; compare the bare form. */
function bareId(id) {
  return String(id).replace(/^session-/, '');
}

/** `2026-10-25 17:11` in the machine's own zone, for the status card. */
function stamp(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * What a profile hands to the model as delegation tools, and which routes a
 * delegated turn may pick. Both live in the profile patch, so a topic's agents
 * are a property of the topic's profile, not of the bridge.
 */
function agentsOf(profile) {
  const text = read(patchPath(profile));
  return { rows: parseSubagentRows(text), selection: parseModelSelection(text) };
}

/** Child sessions this session started, from DSH's projection cache. */
function fleetOf(sessionId) {
  if (!sessionId) return { children: [], policy: null };
  const record = readJson(join(DSH_HOME, 'storages', 'session_projcache', 'sessions', `session-${bareId(sessionId)}.json`));
  return parseSubagentFleet(record);
}

/** Loader rows a profile's own patch declares, nested groupings included. */
function patchRows(profile) {
  const text = read(patchPath(profile));
  return [...text.matchAll(/^\s*-?\s*id:\s*\S+/gm)].length;
}

/** Recent DSH sessions of this workspace, newest first, with their titles. */
function recentSessions(cwd, limit, lang = 'en') {  const root = join(DSH_HOME, 'sessions');
  const rows = [];
  let dirs = [];
  try {
    dirs = readdirSync(root);
  } catch {
    return rows;
  }
  for (const dir of dirs) {
    const path = join(root, dir);
    let files = [];
    try {
      files = readdirSync(path, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of files) {
      // Layout is <slug>/<session-id>/session.v4.jsonl.zstd, so the session id is
      // the directory name and the archive one level below it.
      if (!entry.isDirectory()) continue;
      const full = join(path, entry.name, 'session.v4.jsonl.zstd');
      try {
        rows.push({ cwd: dir, id: entry.name, mtime: statSync(full).mtimeMs });
      } catch {}
    }
  }
  if (rows.length === 0) return rows;
  const cacheDir = join(DSH_HOME, 'storages', 'session_projcache', 'sessions');
  const cacheFiles = (() => {
    try {
      return readdirSync(cacheDir);
    } catch {
      return [];
    }
  })();
  const titles = new Map();
  for (const name of cacheFiles) {
    const record = readJson(join(cacheDir, name));
    const id = name.replace(/^session-/, '').replace(/\.json$/, '');
    const rows = record?.record?.rows ?? record?.rows ?? {};
    const title = rows.title?.val;
    // Sessions that were never titled still carry their first user message.
    const firstMessage = rows.titleInput?.val?.first?.text;
    const cwd = record?.record?.identity?.cwd ?? record?.identity?.cwd;
    const label =
      typeof title === 'string' && title.trim()
        ? title.trim()
        : typeof firstMessage === 'string' && firstMessage.trim()
          ? firstMessage.trim().split('\n')[0].slice(0, 80)
          : '';
    if (label) titles.set(id, { title: label, cwd });
  }
  const live = rows.filter((row) => {
    const meta = titles.get(bareId(row.id));
    return meta && (meta.cwd === cwd || row.cwd === cwdSlug(cwd));
  });
  const pool = live.length > 0 ? live : rows;
  return pool
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, limit)
    .map((row) => ({ ...row, title: titles.get(bareId(row.id))?.title || t(lang, 'ctrl.sessions.untitled') }));
}

/**
 * A session's title, read from DSH's own projection cache. `/sessions` already
 * shows these, and the status card is a worse place to lose one: the card is
 * what a person screenshots. Empty when the session was never titled.
 */
function sessionTitle(id) {
  const record = readJson(join(DSH_HOME, 'storages', 'session_projcache', 'sessions', `session-${bareId(id)}.json`));
  const rows = record?.record?.rows ?? record?.rows ?? {};
  const title = rows.title?.val;
  if (typeof title === 'string' && title.trim()) return title.trim();
  const first = rows.titleInput?.val?.first?.text;
  if (typeof first === 'string' && first.trim()) return first.trim().split('\n')[0].slice(0, 80);
  return '';
}

/** Skills directory listing. */
function skillsOf() {
  const dir = join(DSH_HOME, 'skills');
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

const AGENTS = join(DSH_HOME, 'AGENTS.md');
const PERSONA_HEADING = '## Persona (DSH soul)';

/** Persona section of the global instructions file. */
function soulOf() {
  const text = read(AGENTS);
  const at = text.indexOf(PERSONA_HEADING);
  if (at === -1) return '';
  return text.slice(at + PERSONA_HEADING.length).replace(/^\s*\n/, '').trim();
}

/** Replace (or create) the persona section, leaving the rest untouched. */
function setSoul(text) {
  const body = read(AGENTS);
  const at = body.indexOf(PERSONA_HEADING);
  const head = at === -1 ? `${body.trimEnd()}\n\n` : body.slice(0, at).trimEnd() + '\n\n';
  writeFileSync(AGENTS, `${head}${PERSONA_HEADING}\n\n${text.trim()}\n`, 'utf8');
}

const fmt = (rows) => rows.map((row) => `  ${row}`).join('\n');

/**
 * Named bundles of per-topic agent settings. The file sits next to state.json
 * and keeps its own revision counter, so a write from a second process cannot
 * silently drop a set saved a moment earlier.
 */
const AGENTSETS = join(process.env.DSH_TG_HOME || join(DSH_HOME, 'tg-bridge'), 'agentsets.json');
let agentsetStore = null;
function agentset() {
  if (!agentsetStore) agentsetStore = new AgentsetStore(AGENTSETS).load();
  return agentsetStore;
}

/** The set bound to this topic, or null. */
function agentsetOf(state, key) {
  const id = state.agentsets?.[key];
  return id ? agentset().get(id) : null;
}

/** What the topic's profile declares — the tier every set inherits from. */
function profileRowOf(profile) {
  return profileValues({
    model: modelOf(profile),
    permissions: (parsePermissionPresets(read(patchPath(profile))) || {}).current || '',
    preset: (parseAgentPresets(read(patchPath(profile))) || {}).selected || '',
    effort: '',
    lang: '',
  });
}

/** Bind/unbind this topic. The set itself lives in agentsets.json. */
function bindAgentset(state, key, id) {
  state.agentsets = state.agentsets || {};
  if (id) state.agentsets[key] = id;
  else delete state.agentsets[key];
}

/** One set rendered for a chat: what it owns, what it inherits. */
function agentsetCard(set, lang, profile, boundId) {
  const row = profileRowOf(profile);
  const resolved = resolveSettings({
    set,
    profile: row,
    models: modelsOf(profile),
    efforts: parseReasoningEfforts(read(patchPath(profile)), set.model || row.model) || [],
    permissions: (parsePermissionPresets(read(patchPath(profile))) || {}).presets?.map((p) => p.id) || [],
    presets: (parseAgentPresets(read(patchPath(profile))) || {}).presets?.map((p) => p.id) || [],
  });
  const pick = (field) => (set[field] ? set[field] : `— ${t(lang, 'ctrl.set.inherit')}`);
  const lines = [
    t(lang, `${boundId === set.id ? 'ctrl.set.titleBound' : 'ctrl.set.title'}`, { name: set.name || set.id }),
    `${t(lang, 'ctrl.set.id')}: ${set.id}${set.builtin ? ` (${t(lang, 'ctrl.set.builtin')})` : ''}`,
    `${t(lang, 'ctrl.set.field.model')}: ${pick('model')}`,
    `${t(lang, 'ctrl.set.field.effort')}: ${pick('effort')}`,
    `${t(lang, 'ctrl.set.field.permissions')}: ${pick('permissions')}`,
    `${t(lang, 'ctrl.set.field.preset')}: ${pick('dshPreset')}`,
    `${t(lang, 'ctrl.set.field.lang')}: ${pick('lang')}`,
  ];
  const warnings = [];
  for (const field of ['model', 'effort', 'permissions', 'dshPreset']) {
    if (String(resolved.sources[field] || '').endsWith('(invalid)')) {
      warnings.push(t(lang, 'ctrl.set.dropped', { field }));
    }
  }
  if (set.notes) lines.push('', set.notes);
  if (warnings.length > 0) lines.push('', ...warnings);
  lines.push('', t(lang, 'ctrl.set.hint'));
  return lines.join('\n');
}

/**
 * The same set as real buttons. Only the fields this set actually overrides get
 * a button: a slot that does nothing is worse than no button, and the typed
 * form stays available for everything else. Button payloads are ASCII (`as:`
 * verbs), so a Chinese or Russian label never changes what a press means.
 */
function agentsetKeyboard(set, lang, boundId) {
  const labels = {
    model: t(lang, 'ctrl.set.field.model'),
    effort: t(lang, 'ctrl.set.field.effort'),
    permissions: t(lang, 'ctrl.set.field.permissions'),
    dshPreset: t(lang, 'ctrl.set.field.preset'),
    lang: t(lang, 'ctrl.set.field.lang'),
  };
  const slots = Object.keys(labels)
    .filter((field) => set[field])
    .map((field) => `${labels[field]}|${field}`);
  const rows = cardKeyboard(
    { id: set.id },
    { bound: boundId === set.id, builtin: Boolean(set.builtin), slots },
  );
  if (boundId === set.id) {
    // The "use" button is drawn for every set; on the bound one it says so.
    for (const row of rows) {
      for (const button of row) {
        if (button.data === `as:use:${set.id}`) button.text = `✓ ${t(lang, 'ctrl.set.bound')}`;
      }
    }
  }
  return rows;
}

/**
 * The task list as a keyboard: one button per task, labelled with its number and
 * state. A tap marks the task done and a second tap undoes it, so managing the
 * plan costs no typing. Long lists are cut at Telegram's 100-button limit.
 */
function taskKeyboard(goal) {
  if (!goal || goal.done) return [];
  const rows = [];
  for (let i = 0; i + 2 < Math.min(goal.tasks.length, 90); i += 3) {
    rows.push(goal.tasks.slice(i, i + 3).map((task, k) => {
      const n = i + k + 1;
      return { text: `${task.done ? '✅' : '⬜'} ${n}`, data: `t:${n}` };
    }));
  }
  return rows;
}

/** Goal + task list as one message; empty list is shown, not hidden. */
function goalView(goal, lang) {
  const { done, total } = progressOf(goal);
  const lines = [t(lang, 'goal.set', { text: goal.text })];
  if (goal.tasks.length === 0) {
    lines.push(t(lang, 'task.empty'));
  } else {
    goal.tasks.forEach((task, i) => lines.push(`${task.done ? '✅' : '⬜'} ${i + 1}. ${task.text}`));
    lines.push(t(lang, 'goal.progress', { done, total }));
  }
  if (goal.done) lines.push(t(lang, 'goal.closed'));
  return lines.join('\n');
}

/**
 * Handle one control command. Returns true when the message was a control
 * command and the caller must not run a turn.
 */
export const CONTROL_COMMANDS = [
  'status', 'models', 'model', 'effort', 'profile', 'agents', 'preset', 'permissions', 'plan',
  'jobs', 'remind', 'sessions', 'resume', 'plugins', 'plugin',
  'skills', 'soul', 'restart', 'app', 'stop', 'new', 'seed', 'send', 'cd',
  'prices', 'help', 'doctor', 'logs', 'lang', 'reasoning', 'goal', 'task', 'tasks',
  'thoughts', 'version', 'update', 'crew', 'agentset', 'subscribe', 'settings',
  'rewind', 'fork', 'branches', 'menu',
];

/**
 * Old spellings that no longer have a job of their own. A phone keyboard turns
 * `task` into `tasks` and `model` into `models` without the person noticing, so
 * each pair is ONE command: one name in `/help` and the panel, and the other
 * spelling quietly routed to it. A name that is documented is a name a person
 * can mistype; a name that is not documented is a name nobody has to remember.
 */
export const COMMAND_ALIASES = {
  tasks: 'task',
  models: 'model',
  plugin: 'plugins',
  agentset: 'crew',
};

/**
 * What `/help`, the panel and the Telegram menu are allowed to say. Aliases are
 * deliberately absent: they work, and they are never advertised.
 */
export const DOCUMENTED_COMMANDS = CONTROL_COMMANDS.filter((name) => !COMMAND_ALIASES[name]);

/**
 * Working notes ("💭" lines in the progress message) are on unless the topic or
 * the config says otherwise. Per-topic wins over the install default, so one
 * topic can keep the trail while another stays terse.
 */
export function reasoningOf(state, config, key) {
  const perTopic = state?.reasoning?.[key];
  if (typeof perTopic === 'boolean') return perTopic;
  return config?.reasoning !== false;
}

/**
 * The chat view of `bridge.log`. Delivery chatter ("sent chat=…") answers
 * nothing when the question is "what did the agent do", so the default view
 * hides it — it stays in the file for delivery debugging. `errors` keeps the
 * bridge's own faults and drops tool results, which are part of the work.
 */
export function filterLogLines(lines, filter, count) {
  const isChatter = (line) =>
    /\bsent chat=/.test(line)
    || /\bin \d+ /.test(line)
    || /bridge started|bot @|replaying \d+ pending|topic \d+ (?:seeded|logged)/.test(line);
  const isToolLine = (line) => line.includes('tool[') || /\]\s+(?:pwsh|bash|shell)\b/.test(line);

  let pool;
  if (filter === 'errors') {
    pool = lines.filter((line) => !isToolLine(line)
      && /turn failed|FATAL|unhandled|poll error|Conflict|quota|AUTH|exiting code=[1-9]|cannot |failed to/i.test(line));
  } else if (filter) {
    const needle = filter.toLowerCase();
    pool = lines.filter((line) => line.toLowerCase().includes(needle));
  } else {
    pool = lines.filter((line) => !isChatter(line));
  }
  return { pool, tail: pool.slice(-count) };
}

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
        state: reasoningOf(state, config, key) ? t(lang, 'ctrl.status.on') : t(lang, 'ctrl.status.off'),
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
      // shows them as a preset picker; here they are a profile row, so the
      // switch is honest about being profile-wide: every topic on this profile
      // changes with it.
      const table = parsePermissionPresets(read(patchPath(activeProfile)));
      if (!table) {
        say(t(lang, 'ctrl.perm.none', { name: activeProfile }));
        return true;
      }
      const wanted = String(arg || '').trim();
      if (!wanted) {
        const lines = [
          t(lang, 'ctrl.perm.title', { name: activeProfile }),
          table.current
            ? t(lang, 'ctrl.perm.current', { name: table.current })
            : t(lang, 'ctrl.perm.noCurrent'),
        ];
        for (const preset of table.presets) {
          const mark = preset.id === table.current ? '*' : ' ';
          lines.push(`  ${mark} ${preset.id}${preset.sandbox ? ` — ${preset.sandbox}, ${preset.approval || '?'}` : ''}`);
        }
        if (table.presets.length === 0) lines.push(t(lang, 'ctrl.perm.noPresets'));
        lines.push(t(lang, 'ctrl.perm.hint'));
        say(lines.join('\n'));
        return true;
      }
      if (!table.presets.some((preset) => preset.id === wanted)) {
        say(t(lang, 'ctrl.perm.unknown', {
          name: wanted,
          list: table.presets.map((preset) => preset.id).join(', '),
        }));
        return true;
      }
      if (wanted === table.current) {
        say(t(lang, 'ctrl.perm.already', { name: wanted }));
        return true;
      }
      const next = setRowConfig(read(patchPath(activeProfile)), {
        pkg: '@deepseek-ai/dsh-permission-presets', path: ['defaultPreset'], value: wanted,
      });
      if (!next) { say(t(lang, 'ctrl.perm.already', { name: wanted })); return true; }
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

    case '/jobs': {
      // A turn is one short-lived process, so DSH's own job list dies with it.
      // What survives — and what a person waiting on a reply actually needs —
      // is the bridge's queue: which topics are running now, for how long, and
      // how many waits behind them.
      const snapshot = ctx.jobs ? ctx.jobs() : { active: [], queued: 0, max: 0 };
      const lines = [t(lang, 'ctrl.jobs.title')];
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
      say(lines.join('\n'));
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
        return `${current} ${when}  ${row.title.slice(0, 48)}\n    /resume ${id}`;
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
      const target = (rest[0] === 'headless' || rest[0] === 'desktop') && rest.length > 1 ? rest.shift() : 'desktop';
      const value = rest.join(' ').trim();
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

    case '/skills': {
      const rows = skillsOf();
      const want = (arg || '').trim();
      if (want) {
        const dir = join(DSH_HOME, 'skills', want);
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

    case '/cd': {
      // Bind THIS topic to a project directory. Every later turn in the topic
      // spawns the CLI with that cwd, so "work in my-app" stops
      // meaning "cd ... in every single command".
      const wanted = (arg || '').trim().replace(/^"|"$/g, '');
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
          '',
          t(lang, 'ctrl.cd.bind'),
          t(lang, 'ctrl.cd.resetHint'),
        ];
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
        ctx.saveState();
        say(t(lang, 'cmd.cd.reset'));
        return true;
      }
      let target = wanted;
      // Bare project name -> resolve under ~/Projects for convenience.
      if (!/^[A-Za-z]:|^\//.test(target)) {
        const guess = join(HOME, 'Projects', target);
        if (existsSync(guess)) target = guess;
      }
      if (!existsSync(target)) {
        say(t(lang, 'cmd.cd.none', { path: target }));
        return true;
      }
      state.cwd[key] = target;
      ctx.saveState();
      say(t(lang, 'cmd.cd.bound', { path: target }));
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
      // The list is the control: a tap marks a task done, and the card is
      // redrawn in place. `/task` keeps the typed form for adding.
      const L = lang;
      const current = goalOf(state, key);
      if (!current) { say(t(L, 'task.none')); return true; }
      const rows = taskKeyboard(current);
      if (rows.length === 0) { say(goalView(current, L)); return true; }
      await reply(goalView(current, L), { keyboard: rows });
      return true;
    }

    case '/task': {
      const L = lang;
      const body = (arg || '').trim();
      const current = goalOf(state, key);
      if (!body) {
        say(current ? goalView(current, L) : t(L, 'task.none'));
        return true;
      }
      if (body.toLowerCase() === 'help' || body.toLowerCase() === '?') {
        say(t(L, 'task.usage'));
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
      if (!current) setGoal(state, key, t(L, 'goal.default'));
      const n = addTask(state, key, body);
      if (!n) { say(t(L, 'task.usage')); return true; }
      ctx.saveState();
      say(`${t(L, 'task.added', { n })}\n${goalView(goalOf(state, key), L)}`);
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
      // One switch for "show me the decision trail". Anything but on/off prints
      // the current state, so a bare /reasoning never guesses.
      const wanted = String(arg || '').trim().toLowerCase();
      const on = reasoningOf(state, config, key);
      if (!['on', 'off'].includes(wanted)) {
        const word = t(lang, on ? 'msg.stateOn' : 'msg.stateOff');
        say(t(lang, 'msg.reasoningState', { state: word }));
        return true;
      }
      state.reasoning = state.reasoning || {};
      state.reasoning[key] = wanted === 'on';
      ctx.saveState();
      say(t(lang, wanted === 'on' ? 'msg.reasoningOn' : 'msg.reasoningOff'));
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
      const current = settingsCurrent({ config, state, key, reasoningOf });
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

      const text = file ? lastTurnReasoning(file, { maxChars: 20000 }) : '';
      if (!text) {
        // Not every turn plans: a one-word answer has no reasoning part at all.
        // Saying "here is what the last turn answered" beats a dead end that
        // looks like a broken command.
        const answered = file ? lastTurnText(file, { maxChars: 1200 }) : '';
        say(answered
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
        say(`${head}\n\n${part}${last ? `\n\n${t(lang, 'ctrl.thoughts.hint')}` : ''}`);
      });
      return true;
    }

    case '/version': {
      // Which bridge is running, which one npm has, and whether this install can
      // update itself. A report, so it answers even in the middle of a turn.
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
      // ./sync-runtime.mjs (or /update) has since replaced them, saying so
      // beats a version that reads as live while it is not.
      const started = Date.now() - process.uptime() * 1000;
      const newest = newestModuleMtime(where);
      if (newest && newest > started + 2000) {
        lines.push(t(lang, 'ctrl.version.stale', { when: stamp(newest) }));
      }
      say(lines.join('\n'));
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
      // No argument: where this install stands, in one sentence.
      say(describeUpdate(updateState({ installed, latest, mode: policy.mode, notified: policy.notified })));
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

/**
 * The install-wide update settings: a mode, which release was already announced,
 * when npm was last asked and the version a person chose to stay on. They live
 * in state.json, not in a topic, because it is the install that updates.
 */
function updatePolicy(state) {
  if (!state.update || typeof state.update !== 'object') state.update = { ...UPDATE_DEFAULTS };
  return state.update;
}

/** Where this install's files live. */
function bridgeRoot() {
  return process.env.DSH_BRIDGE_ROOT || join(DSH_HOME, 'tg-bridge');
}

/**
 * Replace this install's files with the given release, fetched from npm into a
 * temp dir and copied over the top: `npm install` inside the bridge's own
 * directory would drop a nested node_modules and leave the running files alone.
 * Everything else in the directory (config, state, logs, backups) is left where
 * it is. Returns the directory name the old files were saved under.
 */
function installRelease(version) {
  const root = bridgeRoot();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `update-backup-${stamp}`;
  const work = join(tmpdir(), `dsh-tg-bridge-${stamp}`);
  try {
    const r = spawnSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--prefix', work, `dsh-tg-bridge@${version}`], {
      encoding: 'utf8',
      shell: true,
      timeout: 240000,
      windowsHide: true,
    });
    if (r.status !== 0) {
      const tail = `${r.stdout || ''}${r.stderr || ''}`.trim().split(/\r?\n/).slice(-6).join('\n');
      throw new Error(`npm exited ${r.status ?? '?'}${tail ? `\n${tail}` : ''}`);
    }
    mkdirSync(join(root, backup), { recursive: true });
    for (const name of readdirSync(join(work, 'package'))) {
      const from = join(work, 'package', name);
      const to = join(root, name);
      if (existsSync(to)) copyFileSync(to, join(backup, name));
      copyFileSync(from, to);
    }
    return backup;
  } finally {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {}
  }
}

/** Version of the bridge this process runs, read from its own package.json. */
function bridgeVersion() {
  const root = process.env.DSH_BRIDGE_ROOT || join(DSH_HOME, 'tg-bridge');
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || '';
  } catch {
    return '';
  }
}

/** Newest mtime among the modules a bridge install is made of, or 0. */
function newestModuleMtime(root) {
  let newest = 0;
  try {
    for (const name of readdirSync(root)) {
      if (!name.endsWith('.mjs')) continue;
      const at = statSync(join(root, name)).mtimeMs;
      if (at > newest) newest = at;
    }
  } catch {}
  return newest;
}

/** Latest published version of an npm package, or '' when npm is unreachable. */
function npmLatest(name) {
  try {
    const r = spawnSync('npm', ['view', name, 'version'], { encoding: 'utf8', shell: true, timeout: 45000, windowsHide: true });
    const out = String(r.stdout || '').trim().split(/\s+/).pop() || '';
    return r.status === 0 && /^\d/.test(out) ? out : '';
  } catch {
    return '';
  }
}

/**
 * The same question, asked without blocking the event loop.
 *
 * The command surface may block for a second (`spawnSync` is simpler and the
 * person is waiting anyway); the poll loop may not, because a stalled `npm view`
 * there would also stop `getUpdates`.
 */
function npmLatestAsync(name = 'dsh-tg-bridge') {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn('npm', ['view', name, 'version'], { shell: true, windowsHide: true });
    } catch {
      resolve('');
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      resolve('');
    }, 45000);
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const version = out.trim().split(/\s+/).pop() || '';
      resolve(code === 0 && /^\d/.test(version) ? version : '');
    });
  });
}

export { DSH_HOME, modelOf, modelsOf, pluginsOf, recentSessions, skillsOf, soulOf, bridgeVersion, npmLatest, npmLatestAsync, installRelease };
