// Plugins and profiles as files on disk: what a profile bundles, enabling one, and the CLI calls that install it.
//
// Split out of `control.mjs` by the 500-line plan: the command handlers that
// follow call these, and none of them needs the dispatcher to do it.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROFILES } from '../paths.mjs';
import { dshLaunch } from '../dsh-launch.mjs';

import { read, readJson, pkgPath, disabledIds } from './models.mjs';
/** Live DSH app PIDs (empty when the app is not running). */
export function listPids() {
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
export async function waitForExit(pids, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const alive = listPids();
    if (!pids.some((pid) => alive.includes(pid))) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** Poll until at least one DSH pid appears (new or old); returns them. */
export async function waitForStart(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const alive = listPids();
    if (alive.length > 0) return alive;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return [];
}

/** Installed packages plus the bundle list of a profile. */
export function pluginsOf(profile) {
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
export function bundleRowIds(profile, name) {
  const dir = join(PROFILES, profile, 'node_modules', name);
  const pkg = readJson(join(dir, 'package.json'));
  const patch = ((pkg || {}).dsh || {}).bundle?.patch || './cordis.patch.yml';
  const text = read(join(dir, patch.replace(/^\.\//, '')));
  const ids = [];
  for (const match of text.matchAll(/^\s*-?\s*id:\s*['"]?([A-Za-z0-9_.@/-]+)['"]?\s*$/gm)) ids.push(match[1]);
  return ids;
}

/** Add a bundle name to `dsh.profile.bundles` when it is not listed yet. */
export function addBundle(profile, name) {
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

export function removeBundle(profile, name) {
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

/** How to run the DSH CLI here, the same answer turns get (see `dsh-launch.mjs`). */
function cliSpawn(args) {
  const launch = dshLaunch({ exists: existsSync });
  // An app that is configured but not installed is not an app: fall back to the
  // command on PATH rather than failing with ENOENT on a path nobody has.
  const usable = launch.kind === 'cli' || existsSync(launch.exe);
  const env = { ...process.env, ...(usable && launch.kind === 'app' ? { ELECTRON_RUN_AS_NODE: '1' } : {}) };
  return spawn(usable ? launch.exe : 'dsh', [...(usable ? launch.lead : []), ...args], { windowsHide: true, env });
}

/**
 * Create a profile from a shipped template, the same way the GUI does it:
 * `dsh <name> --from-default-profile <template>`. `--dump-config` stops right
 * after the profile tree is written, so nothing boots and no plugin is loaded.
 * Dependencies are installed on the profile's first turn.
 */
export function createProfile(name, template, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const child = cliSpawn([name, '--from-default-profile', template, '--dump-config']);
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

export function dshPlugin(profile, args, timeoutMs = 180000) {
  return new Promise((resolve) => {
    // Spawning the .cmd shim with shell:false fails with EINVAL on modern Node,
    // so the app binary runs the CLI entry as Node instead; elsewhere the `dsh`
    // command is already a real executable and needs no entrypoint argument.
    const child = cliSpawn(['plugin', '--profile', profile, ...args]);
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
