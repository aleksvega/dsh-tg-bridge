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
  if (config.autoStart === false) return { started: false, reason: 'disabled' };
  return startBridge({ ctx });
}
