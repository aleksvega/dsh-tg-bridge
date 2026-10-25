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

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function runningPid() {
  try {
    const pid = Number(readFileSync(join(DIR, 'bridge.pid'), 'utf8').trim());
    return pid > 0 && alive(pid) ? pid : 0;
  } catch {
    return 0;
  }
}

export function apply(ctx, config = {}) {
  if (config.autoStart === false) return;
  // Nothing to start until `dsh-tg init` wrote a token and a working directory.
  if (!existsSync(join(DIR, 'config.json'))) return;
  if (runningPid()) return;

  // Two profiles loading at once must not both start a poller.
  const lock = join(DIR, 'plugin-start.lock');
  try {
    const fd = openSync(lock, 'wx');
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
  } catch {
    return;
  }

  let child = null;
  try {
    child = spawn(process.execPath, [join(HERE, 'bridge.mjs')], {
      cwd: DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        // Inside DSH desktop, process.execPath is Electron; this makes it run
        // as Node without opening a window.
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      },
    });
    child.unref();
  } catch {
    child = null;
  } finally {
    try {
      unlinkSync(lock);
    } catch {}
  }

  if (!child?.pid || typeof ctx.on !== 'function') return;
  ctx.on('dispose', () => {
    try {
      if (alive(child.pid)) process.kill(child.pid);
    } catch {}
  });
}
