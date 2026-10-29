// Bridge releases: which version is installed, what npm offers, and how a copy is made before it is replaced.
//
// Split out of `control.mjs` by the 500-line plan: the command handlers that
// follow call these, and none of them needs the dispatcher to do it.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DSH_HOME } from '../paths.mjs';

import { UPDATE_DEFAULTS } from '../update-policy.mjs';
import { checkInstall, isBridgeRoot, restoreBackup, safeUpdateRoot } from '../install-check.mjs';
import { read } from './models.mjs';
import { stamp } from './sessions.mjs';
/**
 * The install-wide update settings: a mode, which release was already announced,
 * when npm was last asked and the version a person chose to stay on. They live
 * in state.json, not in a topic, because it is the install that updates.
 */
export function updatePolicy(state) {
  if (!state.update || typeof state.update !== 'object') state.update = { ...UPDATE_DEFAULTS };
  return state.update;
}

/** Where this install's files live. */
export function bridgeRoot() {
  return process.env.DSH_BRIDGE_ROOT || join(DSH_HOME, 'tg-bridge');
}

/**
 * Replace this install's files with the given release, fetched from npm into a
 * temp dir and copied over the top: `npm install` inside the bridge's own
 * directory would drop a nested node_modules and leave the running files alone.
 * Everything else in the directory (config, state, logs, backups) is left where
 * it is. Returns the directory name the old files were saved under.
 */
/**
 * Copy a fetched release over this install, keeping the old files under `backup`.
 *
 * Split from the npm call so it can be tested at all: the path inside the temp
 * dir and the directory entries (`plugin/`, `skills/`) are exactly what broke
 * `/update confirm` when it was written — it read `<work>/package`, a path npm
 * never creates, and copied entries as if they were all files.
 */
export function copyRelease(fromDir, root, backup) {
  // Refuse to write into a directory that is not a bridge install. The target
  // comes from `DSH_BRIDGE_ROOT`, and an update pointed at a home directory
  // would scatter the package's `docs/`, `test/` and `plugin/` into it.
  if (!safeUpdateRoot(root)) throw new Error(`refusing to write into ${root}: that is a filesystem root or the home directory`);
  if (!isBridgeRoot(root)) throw new Error(`not a bridge install: ${root}`);
  const backupDir = join(root, backup);
  mkdirSync(backupDir, { recursive: true });
  const copied = [];
  for (const name of readdirSync(fromDir)) {
    const from = join(fromDir, name);
    const to = join(root, name);
    if (existsSync(to)) cpSync(to, join(backupDir, name), { recursive: true });
    cpSync(from, to, { recursive: true });
    copied.push(name);
  }
  return copied;
}

export function installRelease(version) {
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
    // `--prefix` puts the package in node_modules; the flat `package` name npm
    // used before v5 has not existed for years.
    copyRelease(join(work, 'node_modules', 'dsh-tg-bridge'), root, backup);
    // Copying first and asking questions later is how a release that cannot load
    // replaces one that works, and the person is left with a bot that does not
    // come back after `/restart`. Check, then keep it or put the old files back.
    const verdict = checkInstall(root);
    if (!verdict.ok) {
      restoreBackup(root, join(root, backup));
      return { backup, rolledBack: true, problems: verdict.problems };
    }
    return { backup, rolledBack: false, problems: [] };
  } finally {
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {}
  }
}

/** Version of the bridge this process runs, read from its own package.json. */
export function bridgeVersion() {
  const root = process.env.DSH_BRIDGE_ROOT || join(DSH_HOME, 'tg-bridge');
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version || '';
  } catch {
    return '';
  }
}

/** Newest mtime among the modules a bridge install is made of, or 0. */
export function newestModuleMtime(root) {
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
export function npmLatest(name) {
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
export function npmLatestAsync(name = 'dsh-tg-bridge') {
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

