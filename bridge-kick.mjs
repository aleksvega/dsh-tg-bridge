// bridge-kick — one-minute supervisor tick.
//
// The DSH-TG-Bridge task only fires every five minutes, so a bridge that exited
// for a code update could wait that long before coming back. This tick is cheap
// and only starts a bridge when the pid file is missing or the process is gone;
// otherwise it exits immediately. A live pid that refuses to die (EPERM) counts
// as alive: refusing to start a second poller is what prevents 409 conflicts.
//
// It also owns the one failure the bridge cannot report about itself. A release
// that throws while it loads never runs a turn, so the turn path records nothing
// and no rollback is ever considered — the tick is the only thing still watching.
// When the install keeps dying without answering, or the record already says the
// version on disk is faulted, this puts the last proven release back before it
// starts the bridge again.
//
// Exit codes: 0 = nothing to do or started, 2 = start failed.

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, openSync, closeSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const DIR = join(DSH_HOME, 'tg-bridge');
const BRIDGE = join(DIR, 'bridge.mjs');
const PID_FILE = join(DIR, 'bridge.pid');
const KICK_LOG = join(DIR, 'kick.log');
const STATE_FILE = join(DIR, 'state.json');
const STARTS_FILE = join(DIR, 'kick-starts.json');

/** How many dead starts, inside this window, mean "this release does not run". */
const CRASH_WINDOW_MS = 15 * 60 * 1000;
const CRASH_STARTS = 2;

// Shared with setup.mjs: a restart holds this lock, so a tick that lands in the
// middle of one must not start a second poller.
//
// A live holder used to disable supervision forever: the old code started the
// bridge with spawnSync(), which blocks until the child EXITS — for a long-lived
// bridge the tick never returned, kept this lock for hours, and every later tick
// logged "restart in progress" and skipped (2026-10-24: supervisor dead from
// 18:57 while the bridge lived). Two fixes: spawn() + unref() below, and
// LOCK_MAX_AGE_MS here so even a genuinely wedged holder cannot wedge the guard.
const LOCK = join(DIR, 'restart.lock');
const LOCK_MAX_AGE_MS = 180_000;

function acquireLock(owner) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(LOCK, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, owner, ts: Date.now() }));
      closeSync(fd);
      // Remove only our own lock: after a stale-lock takeover the file belongs
      // to the new holder, and a late exit must not steal it.
      const release = () => {
        try {
          if (Number(JSON.parse(readFileSync(LOCK, 'utf8')).pid) === process.pid) unlinkSync(LOCK);
        } catch {}
      };
      process.on('exit', release);
      return release;
    } catch (error) {
      if (error.code !== 'EEXIST') return null;
      let held = 0;
      let heldTs = 0;
      try {
        const info = JSON.parse(readFileSync(LOCK, 'utf8'));
        held = Number(info.pid) || 0;
        heldTs = Number(info.ts) || 0;
      } catch {}
      const age = heldTs ? Date.now() - heldTs : Number.POSITIVE_INFINITY;
      let alive = false;
      if (held) {
        try { process.kill(held, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
      }
      // Age wins over liveness: a holder that has not finished a restart in
      // LOCK_MAX_AGE_MS is wedged, not busy.
      if (alive && age < LOCK_MAX_AGE_MS) return null;
      try { unlinkSync(LOCK); } catch {}
    }
  }
  return null;
}

function log(line) {
  try {
    appendFileSync(KICK_LOG, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {}
}

function pidFromFile() {
  try {
    const pid = Number(readFileSync(PID_FILE, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}

/** True when the pid exists; a permission error still means "alive". */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function bridgePids() {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'bridge\\.mjs' } | Select-Object -ExpandProperty ProcessId"],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  return (r.stdout || '').split(/\r?\n/).map((v) => Number(v.trim())).filter((v) => Number.isInteger(v) && v > 0);
}

/** The starts this tick has issued, and when. */
function readStarts() {
  try {
    const raw = JSON.parse(readFileSync(STARTS_FILE, 'utf8'));
    return Array.isArray(raw) ? raw.filter((v) => Number.isFinite(Number(v))) : [];
  } catch {
    return [];
  }
}

function writeStarts(list) {
  try {
    writeFileSync(STARTS_FILE, JSON.stringify(list), 'utf8');
  } catch {}
}

/**
 * Did the last starts all end without the bridge ever becoming healthy?
 *
 * A start is "dead" when the pid it produced is gone and no bridge is running,
 * which is exactly the situation this tick is in when it decides to start one.
 * The count is reset by a healthy pid, so a laptop that reboots twice in an hour
 * is not mistaken for a broken release.
 */
function crashLoop(now = Date.now()) {
  const recent = readStarts().filter((at) => now - Number(at) <= CRASH_WINDOW_MS);
  writeStarts(recent);
  return recent.length >= CRASH_STARTS;
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
}

/**
 * Put the last proven release back when the version on disk cannot run.
 *
 * Loaded lazily and inside a try/catch: this tick must never be the reason a
 * working bridge stays down, and `stability.mjs` imports the release module that
 * shells out to npm. If the import fails, the tick starts the bridge as it is.
 */
async function maybeRollback(evidence) {
  let target = '';
  try {
    const { startupRollback, applyRollback } = await import('./stability.mjs');
    const state = readState();
    const { bridgeVersion } = await import('./control/release.mjs');
    const installed = bridgeVersion();
    target = startupRollback(state, installed, evidence);
    if (!target) return '';
    log(`release ${installed} has not proven itself (${evidence.crashLoop ? 'crash loop' : 'recorded faults'}): restoring ${target}`);
    const result = await applyRollback(state, { version: target, lang: 'en', t: (_l, key) => key, log });
    // The stamp the next tick reads. It is set even when the restore failed: a
    // supervisor that retries a broken registry every sixty seconds is a log
    // loop, not a recovery.
    const release = state.release && typeof state.release === 'object' ? state.release : (state.release = {});
    release.startupRolledBackAt = Date.now();
    // The state file is the record the next tick reads: write it even when the
    // restore failed, so a repeated failure is visible instead of retried blind.
    try {
      const { writeAtomic } = await import('./state.mjs');
      writeAtomic(STATE_FILE, JSON.stringify(state, null, 2));
    } catch {}
    log(`rollback to ${target}: ${result.ok ? `ok via ${result.via}` : `failed (${(result.problems || []).join(' | ').slice(0, 200)})`}`);
    return result.ok ? target : '';
  } catch (error) {
    log(`rollback skipped: ${String(error?.message ?? error).slice(0, 200)}`);
    return '';
  }
}

async function main() {
  if (!acquireLock('kick')) {
    log('restart in progress (setup holds the lock), skipping this tick');
    return 0;
  }  if (!existsSync(BRIDGE)) {
    log('bridge.mjs missing');
    return 2;
  }
  // A restart marker with an empty queue means the previous process exited on
  // purpose: start it again and clear the marker.
  const marker = join(DIR, 'restart.pending');
  const restartPending = existsSync(marker);

  const filePid = pidFromFile();
  // Cheap path first: a live pid file is authoritative for a healthy bridge, so
  // the minute tick costs one kill(0) instead of a PowerShell process scan.
  if (filePid && alive(filePid)) {
    if (restartPending) log(`marker present but pid ${filePid} alive`);
    // A live bridge proves the release can start: forget the crash history.
    writeStarts([]);
    return 0;
  }
  // Only when the pid file is stale or missing: scan for a bridge that started
  // without writing one.
  const live = bridgePids();
  if (live.length > 0) {
    log(`pid file stale (${filePid || 'missing'}), bridge ${live.join(',')} alive — not starting`);
    return 0;
  }

  const loop = crashLoop();
  const restored = await maybeRollback({ crashLoop: loop });
  if (restored) {
    // The restored files are on disk; this start is the test of them, and the
    // crash counter starts from zero so one bad release cannot fail twice.
    writeStarts([]);
  }
  log(restartPending ? 'marker present and no bridge: starting' : 'no bridge: starting');
  // spawn(), NOT spawnSync(): spawnSync waits for the child to exit, and this
  // child is meant to outlive the tick.
  let child;
  try {
    child = spawn(process.execPath, ['--dns-result-order=ipv4first', BRIDGE], {
      cwd: DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (error) {
    log(`start failed: ${error.message}`);
    return 2;
  }
  child.unref();
  if (!restored) writeStarts([...readStarts(), Date.now()]);
  log(`start issued pid=${child.pid ?? '?'}`);
  return 0;
}

main().then((code) => process.exit(code), (error) => {
  log(`tick failed: ${String(error?.message ?? error).slice(0, 200)}`);
  process.exit(2);
});
