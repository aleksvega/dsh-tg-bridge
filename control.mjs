// dsh-telegram-bridge — control plane.
//
// The command surface that makes DSH manageable from Telegram with no UI:
// profiles, model, sessions, plugins (extensions), skills, persona, restarts.
// Everything works on the same files DSH itself reads, so a running desktop app
// and a headless turn see the same state; commands that need a reload say so.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, LANGS, normalizeLang } from './i18n.mjs';
import { addTask, clearGoal, doneTask, finishGoal, goalOf, progressOf, removeTask, setGoal } from './goals.mjs';

const HOME = homedir();
const DSH_HOME = process.env.DSH_HOME || join(HOME, '.dsh');
const PROFILES = join(DSH_HOME, 'profiles');
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

/** Recent DSH sessions of this workspace, newest first, with their titles. */
function recentSessions(cwd, limit, lang = 'ru') {
  const root = join(DSH_HOME, 'sessions');
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
  'status', 'models', 'model', 'profile', 'sessions', 'resume', 'plugins', 'plugin',
  'skills', 'soul', 'restart', 'app', 'stop', 'new', 'seed', 'send', 'cd',
  'prices', 'help', 'doctor', 'logs', 'lang', 'reasoning', 'goal', 'task',
];

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

export async function handleControl(ctx) {
  const { command, arg, send, reply, log, profile, state, key, config, lang } = ctx;
  const say = (text) => reply(text);
  // A topic can run on its own profile (its own plugins, model and skills);
  // without one it follows the install default.
  const activeProfile = profile || config.profile || 'headless';

  // One command for one job: `/plugins` is both the list and the way to change
  // things. Two near-identical names (`/plugin` / `/plugins`) invited the exact
  // mistake of typing the plural with an action. The singular form stays as an
  // alias so old instructions and muscle memory keep working.
  let effective = command;
  if (effective === '/plugins') {
    const [maybeAction] = String(arg || '').trim().split(/\s+/);
    // `/plugins add|remove|disable|enable …` is the same work as `/plugin …`;
    // the case bodies read `arg`, which already holds the action and its value.
    if (['add', 'remove', 'disable', 'enable'].includes((maybeAction || '').toLowerCase())) {
      effective = '/plugin';
    }
  }

  switch (effective) {
    case '/status': {
      const head = modelOf(activeProfile);
      const session = state.sessions[key] || t(lang, 'ctrl.session.none');
      const active = ctx.activeTurns ? ctx.activeTurns.size : 0;
      const lines = [
        t(lang, 'ctrl.status.profile', { name: activeProfile, route: `${head.provider}/${head.model}` }),
        t(lang, 'ctrl.status.thread', { name: ctx.threadId || t(lang, 'ctrl.status.threadDefault') }),
        t(lang, 'ctrl.status.session', { id: session }),
        t(lang, 'ctrl.status.turns', { n: active }),
        t(lang, 'ctrl.status.skills', { n: skillsOf().length }),
        `DSH_HOME: ${DSH_HOME}`,
      ];
      // The desktop profile only matters when this install actually has one.
      if (existsSync(join(PROFILES, 'desktop', 'cordis.patch.yml'))) {
        const desk = modelOf('desktop');
        const deskPlugins = pluginsOf('desktop');
        lines.splice(1, 0, t(lang, 'ctrl.status.ui', {
          route: `${desk.provider}/${desk.model}`,
          n: deskPlugins.bundles.length,
        }));
      }
      const currentGoal = goalOf(state, key);
      if (currentGoal) {
        const { done, total } = progressOf(currentGoal);
        lines.push(t(lang || 'ru', 'status.goal', {
          done, total, text: currentGoal.text.length > 60 ? `${currentGoal.text.slice(0, 59)}…` : currentGoal.text,
        }));
      }
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
        say(t(ctx.lang || 'ru', 'cmd.restart.prompt'));
        return true;
      }
      say(t(ctx.lang || 'ru', 'cmd.restart.started'));
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
      say(killed ? t(ctx.lang || 'ru', 'cmd.stop.killed') : t(ctx.lang || 'ru', 'cmd.stop.nothing'));
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
        const current = state.cwd[key] || config.cwd;
        const lines = [
          t(lang, 'ctrl.cd.current'),
          current,
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
        say(t(ctx.lang || 'ru', 'cmd.cd.reset'));
        return true;
      }
      let target = wanted;
      // Bare project name -> resolve under ~/Projects for convenience.
      if (!/^[A-Za-z]:|^\//.test(target)) {
        const guess = join(HOME, 'Projects', target);
        if (existsSync(guess)) target = guess;
      }
      if (!existsSync(target)) {
        say(t(ctx.lang || 'ru', 'cmd.cd.none', { path: target }));
        return true;
      }
      state.cwd[key] = target;
      ctx.saveState();
      say(t(ctx.lang || 'ru', 'cmd.cd.bound', { path: target }));
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
      const L = lang || 'ru';
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
      if (word === 'clear') {
        say(t(L, clearGoal(state, key) ? 'goal.cleared' : 'goal.none'));
        if (goalOf(state, key) === null) ctx.saveState();
        return true;
      }
      const goal = setGoal(state, key, body);
      if (!goal) { say(t(L, 'goal.usage')); return true; }
      ctx.saveState();
      say(goalView(goal, L));
      return true;
    }

    case '/task': {
      const L = lang || 'ru';
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

    case '/new': {
      delete state.sessions[key];
      ctx.saveState();
      say(t(ctx.lang || 'ru', 'cmd.new.done'));
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
      const helpLang = normalizeLang(state.lang?.[key] || config.lang) || 'ru';
      say(t(helpLang, 'help.body'));
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

      // Project directory bound to this topic and whether it exists.
      const cwd = (state.cwd && state.cwd[key]) || config.cwd;
      add(t(lang, 'ctrl.doctor.cwd'), `${cwd}${existsSync(cwd) ? '' : t(lang, 'ctrl.doctor.cwdMissing')}`);

      add(t(lang, 'ctrl.doctor.session'), state.sessions[key] || t(lang, 'ctrl.doctor.sessionNew'));
      say(`${t(lang, 'ctrl.doctor.title')}\n\n${rows.join('\n')}`);
      return true;
    }

    case '/logs': {
      // `/logs` — meaningful events, `/logs 100` — more, `/logs <text>` —
      // filter, `/logs errors` — failures only.
      const file = join(DSH_HOME, 'tg-bridge', 'bridge.log');
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

      // Delivery chatter ("in 123", "sent chat=...") answers nothing when the
      // question is "what did the agent do". It stays in the file for delivery
      // debugging but is hidden from the chat view.
      const isChatter = (line) =>
        /\bsent chat=/.test(line)
        || /\bin \d+ /.test(line)
        || /bridge started|bot @|replaying \d+ pending|topic \d+ (?:seeded|logged)/.test(line);

      let pool;
      if (filter === 'errors') {
        pool = lines.filter((line) => /turn failed|ОШИБКА|error|poll error|409|Conflict|quota|AUTH/i.test(line));
      } else if (filter) {
        const needle = filter.toLowerCase();
        pool = lines.filter((line) => line.toLowerCase().includes(needle));
      } else {
        pool = lines.filter((line) => !isChatter(line));
      }

      if (pool.length === 0) {
        say(filter ? t(lang, 'ctrl.logs.noMatch', { filter }) : t(lang, 'ctrl.logs.empty'));
        return true;
      }
      const tail = pool.slice(-count);
      const header = filter === 'errors'
        ? t(lang, 'ctrl.logs.errors', { shown: tail.length, total: pool.length })
        : t(lang, 'ctrl.logs.title', { shown: tail.length, total: pool.length });
      say(`${header}\n\n${tail.join('\n')}`);
      return true;
    }

    default:
      return false;
  }
}

export { DSH_HOME, modelOf, modelsOf, pluginsOf, recentSessions, skillsOf, soulOf };
