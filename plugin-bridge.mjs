// DSH plugin entry: run the Telegram bridge alongside the harness.
//
// The bridge is a separate long-polling process, not a tool inside the agent,
// so the plugin starts it once when the host boots and stops it on shutdown.
// It never starts a second copy: a live `bridge.pid` wins. That keeps the
// scheduled-task install and this plugin from polling the same bot twice.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'tg-bridge';
export const inject = [];

const HERE = dirname(fileURLToPath(import.meta.url));
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const DIR = join(DSH_HOME, 'tg-bridge');

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function runningPid(dir = DIR) {
  try {
    const pid = Number(readFileSync(join(dir, 'bridge.pid'), 'utf8').trim());
    return pid > 0 && alive(pid) ? pid : 0;
  } catch {
    return 0;
  }
}

/**
 * Start one bridge process, unless a bridge is already running or another
 * profile is starting one right now.
 *
 * Exported because `apply` cannot be exercised without booting a desktop, and
 * booting a desktop to test "does it start twice" is how a test starts a second
 * poller by accident. A test passes a temporary directory and a spawn that
 * records its arguments instead.
 *
 * @returns {{started: boolean, reason?: string, pid?: number}}
 */
export function startBridge({
  dir = DIR,
  ctx,
  spawnImpl = spawn,
  script = join(HERE, 'bridge.mjs'),
  execPath = process.execPath,
  env = process.env,
} = {}) {
  // Nothing to start until `dsh-tg init` wrote a token and a working directory.
  if (!existsSync(join(dir, 'config.json'))) return { started: false, reason: 'unconfigured' };
  if (runningPid(dir)) return { started: false, reason: 'running' };

  // Two profiles loading at once must not both start a poller.
  const lock = join(dir, 'plugin-start.lock');
  try {
    const fd = openSync(lock, 'wx');
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  } catch {
    return { started: false, reason: 'locked' };
  }

  let child = null;
  try {
    child = spawnImpl(execPath, [script], {
      cwd: dir,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...env,
        // Inside DSH desktop, process.execPath is Electron; this makes it run
        // as Node without opening a window.
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
    });
    child?.unref?.();
  } catch {
    child = null;
  } finally {
    try {
      unlinkSync(lock);
    } catch {}
  }

  if (!child?.pid) return { started: false, reason: 'spawn-failed' };
  if (typeof ctx?.on === 'function') {
    ctx.on('dispose', () => {
      try {
        if (alive(child.pid)) process.kill(child.pid);
      } catch {}
    });
  }
  return { started: true, pid: child.pid };
}

export function apply(ctx, config = {}) {
  const started = config.autoStart === false ? { started: false, reason: 'disabled' } : startBridge({ ctx });
  // The membership list is the host's to write. Issue #3 pointed at the right
  // shape: the bridge edits `workspace.json` from a separate process, and a live
  // host holds that file in memory, so its next write can drop the id the bridge
  // just added. This runs inside the host, so it can attach what the headless
  // turns created without racing anyone.
  reconcileSessions(ctx);
  return started;
}

/** How often an id created by a headless turn is looked for, in ms. */
const RECONCILE_MS = 30000;

/**
 * A host service, or `undefined` when this host does not have one.
 *
 * Cordis defines a service on the context only for the names an entry declares
 * in `inject`, and reading an undeclared one throws instead of answering. The
 * plugin is optional by design — it has to load in a headless profile that has
 * no workspaces at all — so the read itself is what needs the guard: a real boot
 * failed here with "cannot get property workspaceRegistry without inject", and
 * the plugin never activated.
 */
function service(ctx, name) {
  try {
    return ctx?.[name];
  } catch {
    return undefined;
  }
}

/**
 * Attach the sessions nobody grouped, from inside the host that owns the list.
 *
 * `sessionPersistence.list()` re-reads the artifacts on every call, so a session
 * written by the spawned `dsh --profile headless` is visible here even though it
 * was never live in this process. `attachSession` rejects an id whose folder is
 * not the workspace's path, which is the check — a wrong group is worse than
 * Ungrouped, because it claims the session ran somewhere it never did.
 *
 * Exported so a test can drive it with a fake context: booting a desktop to
 * check "does the group follow the folder" would test the desktop, not this.
 *
 * @returns {{ attached: number, skipped: number, reason?: string }}
 */
export async function reconcileOnce(ctx) {
  const registry = service(ctx, 'workspaceRegistry');
  const persistence = service(ctx, 'sessionPersistence');
  const listRaw = registry?.list;
  const persistRaw = persistence?.list;
  if (typeof listRaw !== 'function' || typeof persistRaw !== 'function') {
    return { attached: 0, skipped: 0, reason: 'no-services' };
  }
  const spaces = (await listRaw.call(registry)) ?? [];
  const sessions = (await persistRaw.call(persistence)) ?? [];
  const known = new Set(spaces.flatMap((space) => space?.sessionIds ?? []));
  let attached = 0;
  let skipped = 0;
  for (const entry of sessions) {
    const header = entry?.header ?? entry;
    const id = String(header?.id ?? '');
    // Subagents and children belong to their parent's story, not to a group of
    // their own; an id with no folder cannot be matched, so it is left alone.
    if (!id || known.has(id) || !header?.cwd) continue;
    if (header.origin === 'subagent' || header.parentSession !== undefined) {
      skipped += 1;
      continue;
    }
    let done = false;
    for (const space of spaces) {
      if (typeof space?.attachSession !== 'function') continue;
      try {
        await space.attachSession(id);
        done = true;
        break;
      } catch {
        // The folder is not this workspace's: try the next one.
      }
    }
    if (done) {
      attached += 1;
      known.add(id);
    } else {
      skipped += 1;
    }
  }
  return { attached, skipped };
}

/** Run `reconcileOnce` on a timer while the host lives; quiet when it cannot. */
function reconcileSessions(ctx) {
  if (typeof service(ctx, 'workspaceRegistry')?.list !== 'function') return;
  if (typeof service(ctx, 'sessionPersistence')?.list !== 'function') return;
  const tick = () => {
    void reconcileOnce(ctx).catch(() => {});
  };
  tick();
  const timer = setInterval(tick, RECONCILE_MS);
  timer?.unref?.();
  if (typeof ctx?.on === 'function') {
    ctx.on('dispose', () => clearInterval(timer));
  }
}

