// dsh-bridge setup — one command that makes the Telegram bridge healthy.
//
// Why a script: the fixes accumulated across a dozen sessions (IPv4 DNS order,
// retries, session pinning, bot menu, timeouts) and half of them only apply
// after a clean restart. Doing that by hand over SSH is error-prone; this
// script is idempotent and reports what it changed.
//
// Usage:
//   node setup.mjs            apply everything and restart the bridge
//   node setup.mjs --check    report state only, change nothing
//
// What it does, in order:
//   1. sanity: node version, free disk space, token present
//   2. stop every running bridge process (the scheduled task restarts one)
//   3. start one bridge with --dns-result-order=ipv4first
//   4. align the scheduled task action with the same flags
//   5. install the bot command menu
//   6. prove it: wait, then show whether Telegram calls fail

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, openSync, closeSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const BRIDGE_DIR = join(DSH_HOME, 'tg-bridge');
const BRIDGE = join(BRIDGE_DIR, 'bridge.mjs');
const CONFIG = join(BRIDGE_DIR, 'config.json');
const CRED = join(DSH_HOME, '.credentials.yaml');
const LOG = join(BRIDGE_DIR, 'bridge.log');
const SETUP_LOG = join(BRIDGE_DIR, 'setup.log');
const NODE = process.execPath;

// One restart at a time: setup (kill + start) and the 1-minute kick both start
// bridges, and run concurrently they produced two pollers and endless 409s.
const LOCK = join(BRIDGE_DIR, 'restart.lock');
function acquireLock(owner) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(LOCK, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, owner, ts: Date.now() }));
      closeSync(fd);
      const release = () => { try { unlinkSync(LOCK); } catch {} };
      process.on('exit', release);
      return release;
    } catch (error) {
      if (error.code !== 'EEXIST') return null;
      let held = 0;
      try { held = Number(JSON.parse(readFileSync(LOCK, 'utf8')).pid) || 0; } catch {}
      let alive = false;
      if (held) {
        try { process.kill(held, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
      }
      if (alive) return null;
      try { unlinkSync(LOCK); } catch {}
    }
  }
  return null;
}

const check = new Set(process.argv.slice(2)).has('--check');

/**
 * Every step is written to setup.log as well as stdout.
 *
 * The scheduled refresh reported exit code 0 while the bridge kept running the
 * old process: without a log there was no way to see WHICH step failed. A
 * setup run must leave evidence behind even when it is launched hidden by the
 * Task Scheduler, where nobody sees stdout.
 */
function record(level, text) {
  const line = `${new Date().toISOString()} [${level}] ${text}`;
  try {
    appendFileSync(SETUP_LOG, `${line}\n`, 'utf8');
  } catch {}
  console.log(level === 'ok' ? `  ok   ${text}` : level === 'warn' ? `  warn ${text}` : `  FAIL ${text}`);
}

const ok = (text) => record('ok', text);
const warn = (text) => record('warn', text);
const fail = (text) => record('fail', text);

function run(command, args, options = {}) {
  return spawnSync(command, args, { windowsHide: true, encoding: 'utf8', ...options });
}

/** Free bytes on the system drive. */
function freeBytes() {
  try {
    const r = run('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      "(Get-PSDrive C).Free",
    ]);
    return Number((r.stdout || '').trim()) || 0;
  } catch {
    return 0;
  }
}

/** True when the pid exists — EPERM still means alive (another user's process). */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/** PID recorded by the bridge itself; the only reliable source for processes
 * whose Win32_Process.CommandLine is empty (an elevated instance started by the
 * scheduled task shows no command line at all, which is exactly how a stale
 * poller survived a "no bridge processes left" report and produced 409s). */
function pidFilePid() {
  try {
    const pid = Number(readFileSync(join(BRIDGE_DIR, 'bridge.pid'), 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : 0;
  } catch {
    return 0;
  }
}

/** PIDs of running bridge processes: command-line matches plus the pid file. */
function bridgePids() {
  let pids = [];
  try {
    // Match the full script path, not just "bridge.mjs": a second install with
    // its own DSH_HOME and token is a different bot and must not be killed.
    const filter = `$_.CommandLine -and $_.CommandLine.Contains('${BRIDGE}')`;
    const r = run('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { ${filter} } | Select-Object -ExpandProperty ProcessId`,
    ]);
    pids = (r.stdout || '')
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    pids = [];
  }
  const fromFile = pidFilePid();
  if (fromFile && !pids.includes(fromFile)) pids.push(fromFile);
  return pids;
}

function token() {
  const env = (process.env.DSH_TELEGRAM_BOT_TOKEN || '').trim();
  if (env) return env;
  try {
    const yaml = readFileSync(CRED, 'utf8');
    // `dsh-tg init` writes the plain name; the DSH app adds a random suffix.
    const m = /^\s*(DSH_TELEGRAM_BOT_TOKEN[A-Z0-9_]*):\s*["']?([^"'\s]+)/m.exec(yaml);
    return m ? m[2] : '';
  } catch {
    return '';
  }
}

/** Last N lines of the bridge log. */
function logTail(n = 12) {
  try {
    const lines = readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

async function main() {
  console.log('dsh-bridge setup\n');
  // A kick tick may be starting the bridge at this exact moment; the lock makes
  // one of them lose instead of both starting a poller.
  if (!acquireLock('setup')) {
    fail('another restart is already running (setup or kick) — try again in a few seconds');
    return 1;
  }

  // 1. Sanity.
  const major = Number(process.versions.node.split('.')[0]);
  // 24 is not a preference: every command that opens a session decompresses a
  // zstd frame, and node:zlib only grew that codec in 24.
  if (major >= 24) ok(`node ${process.versions.node}`);
  else fail(`node ${process.versions.node} is too old (need >= 24)`);

  const free = freeBytes();
  if (free > 2 * 1024 ** 3) ok(`disk free ${(free / 1024 ** 3).toFixed(1)} GB`);
  else if (free > 512 * 1024 ** 2) warn(`disk free only ${(free / 1024 ** 3).toFixed(2)} GB — model installs will struggle`);
  else fail(`disk free ${(free / 1024 ** 2).toFixed(0)} MB — too low, clean caches first`);

  if (!existsSync(BRIDGE)) {
    fail(`bridge not found at ${BRIDGE}`);
    return 1;
  }
  ok(`bridge script ${BRIDGE}`);

  const botToken = token();
  if (botToken) ok(`telegram token found (${botToken.length} chars)`);
  else fail('telegram token missing in ~/.dsh/.credentials.yaml');

  if (existsSync(CONFIG)) {
    try {
      const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
      ok(`config: profile=${config.profile} idle=${Math.round((config.turnIdleMs ?? 0) / 1000)}s hard=${Math.round((config.turnTimeoutMs ?? 0) / 60000)}min`);
      if (config.generalLobby === false) warn('generalLobby is off: messages in General will run there, not in a topic');
      if (!config.vision?.patch) warn('vision.patch missing: photos will not reach a model that can see them');
    } catch (error) {
      fail(`config.json is not valid JSON: ${error.message}`);
    }
  } else {
    warn('config.json missing: defaults will be used');
  }

  if (!botToken) return 1;

  const pids = bridgePids();
  ok(`running bridges: ${pids.length === 0 ? 'none' : pids.join(', ')}`);

  if (check) {
    console.log('\n--check: nothing changed. Re-run without --check to apply.');
    return 0;
  }

  // 2. Stop every bridge. taskkill is used instead of process.kill: the pid
  // may belong to a process this script cannot signal, and a silent failure
  // here means the old code keeps running while the script reports success.
  for (const pid of pids) {
    const killed = run('taskkill', ['/PID', String(pid), '/T', '/F']);
    const out = `${killed.stdout || ''}${killed.stderr || ''}`.trim().replace(/\s+/g, ' ');
    if (killed.status === 0 || /not found|не найден/i.test(out)) {
      ok(`stopped bridge pid ${pid}`);
      continue;
    }
    // Access denied is the norm for the elevated instance the scheduled task
    // owns (RunLevel Highest): a normal user token cannot signal it. Stop the
    // task instead — that terminates its process tree.
    if (/access is denied|отказано в доступе/i.test(out)) {
      run('powershell', ['-NoProfile', '-NonInteractive', '-Command', "Stop-ScheduledTask -TaskName 'DSH-TG-Bridge' -ErrorAction SilentlyContinue"]);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      if (!alive(pid)) ok(`stopped elevated bridge pid ${pid} via the scheduled task`);
      else fail(`could not stop elevated bridge pid ${pid} (task stop did not help)`);
      continue;
    }
    fail(`could not stop bridge pid ${pid}: ${out.slice(0, 160)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const survivors = bridgePids();
  if (survivors.length > 0) fail(`bridge still alive after kill: ${survivors.join(', ')}`);
  else ok('no bridge processes left');

  // 3. Start one bridge with the IPv4 DNS order. Kept as a single quoted
  // argument list: the previous string-building produced a broken command line
  // ("--dns-result-order=ipv4first","C:\...") and Start-Process failed without
  // a visible error.
  const startScript = [
    `$args = @('--dns-result-order=ipv4first', '${BRIDGE}')`,
    `Start-Process -FilePath '${NODE}' -ArgumentList $args -WorkingDirectory '${BRIDGE_DIR}' -WindowStyle Hidden`,
    "'started'",
  ].join('; ');
  const started = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', startScript]);
  if ((started.stdout || '').includes('started')) ok('bridge start command issued');
  else fail(`could not start the bridge: ${(started.stderr || '').trim().slice(0, 200)}`);

  await new Promise((resolve) => setTimeout(resolve, 4000));
  const fresh = bridgePids();
  if (fresh.length === 1) ok(`new bridge pid ${fresh[0]}`);
  else if (fresh.length === 0) fail('bridge did not start');
  else warn(`unexpected bridge count: ${fresh.join(', ')}`);

  // 3b. Prove the restart with a call that cannot steal the poll: getUpdates
  // would cancel the bridge's own long poll, so probe getMe (network + token)
  // and treat a fresh 409 in the log as proof that a stale poller is alive.
  const probe = await (async () => {
    try {
      const r = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, { signal: AbortSignal.timeout(15000) });
      return { status: r.status, body: await r.text() };
    } catch (error) {
      return { status: 0, body: String(error?.message ?? error) };
    }
  })();
  if (probe.status === 200) ok('telegram reachable, token valid (getMe)');
  else warn(`telegram getMe failed: ${probe.status} ${probe.body.slice(0, 120)}`);

  const recentConflict = logTail(30).some((line) => {
    const m = /^(\S+) poll error:.*Conflict/i.exec(line);
    return m ? Date.now() - Date.parse(m[1]) < 90_000 : false;
  });
  if (recentConflict) fail('a stale poller still owns getUpdates (409 in the last 90s) — kill it, then re-run setup');
  else ok('no 409 conflicts in the last 90s');

  // 4. Scheduled task: point it at the GUARDED HIDDEN launcher (wscript + bridge-kick).
  //    Two reasons it must be the guarded supervisor and not a direct node.exe start:
  //    (a) a console action on an Interactive-logon task pops a window at every logon
  //        and repetition — wscript with window style 0 never shows one;
  //    (b) starting bridge.mjs directly here races the one-minute tick: both see "no
  //        bridge" and both start a poller (409 getUpdates Conflict). Going through
  //        bridge-kick.mjs means every start happens under restart.lock after a check.
  const vbsPath = join(BRIDGE_DIR, 'bridge-kick-hidden.vbs');
  writeFileSync(
    vbsPath,
    [
      "' hidden launcher: DSH bridge supervisor tick (no console window)",
      'Set sh = CreateObject("WScript.Shell")',
      `sh.CurrentDirectory = "${BRIDGE_DIR}"`,
      `rc = sh.Run("""${NODE}"" ""${join(BRIDGE_DIR, 'bridge-kick.mjs')}""", 0, True)`,
      'WScript.Quit rc',
      '',
    ].join('\r\n'),
  );
  const task = run('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `$a = New-ScheduledTaskAction -Execute 'C:\\Windows\\System32\\wscript.exe' -Argument '//B //Nologo "${vbsPath}"'; Set-ScheduledTask -TaskName 'DSH-TG-Bridge' -Action $a | Out-Null; 'ok'`,
  ]);
  if ((task.stdout || '').includes('ok')) ok('scheduled task DSH-TG-Bridge now runs the guarded hidden supervisor');
  else warn(`scheduled task not updated: ${(task.stderr || '').trim().slice(0, 160)}`);

  // 5. Bot menu.
  const menu = run(NODE, [join(BRIDGE_DIR, 'bot-menu.mjs')]);
  if ((menu.stdout || '').includes('menu installed')) {
    ok((menu.stdout || '').trim().split('\n')[0]);
  } else {
    warn(`bot menu not installed: ${(menu.stderr || '').trim().slice(0, 160)}`);
  }

  // 6. Prove it: a minute of observation.
  console.log('\nwatching the log for 30s…');
  const startedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 30000));
  const tail = logTail(8);
  // Only lines written by THIS process count: the tail still carries the 409s
  // of the stale poller that was just killed, and counting them reported a
  // healthy restart as a network failure.
  const failures = tail.filter((line) => {
    const m = /^(\S+) /.exec(line);
    if (!m) return false;
    return Date.parse(m[1]) >= startedAt - 5000 && /poll error|fetch failed/i.test(line);
  });
  for (const line of tail) console.log(`  ${line.slice(0, 120)}`);
  if (failures.length === 0) ok('no network errors after restart');
  else warn(`${failures.length} network error line(s) — check VPN/DNS`);

  console.log('\nDone. Send the bot a message; the answer should arrive.');
  return 0;
}

main().then((code) => process.exit(code ?? 0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
