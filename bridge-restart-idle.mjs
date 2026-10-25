// bridge-restart-idle — restart the bridge only when no turn is running.
//
// v1 watched for a "sent chat=" log line and died before acting (pipes inside a
// detached process). v2 polls the process tree instead: a turn is running while
// a DeepSeek Harness.exe child belongs to the bridge. Restart happens only after
// several consecutive checks find no such child, so the pending reply is already
// delivered and nothing is killed mid-answer.
//
// Usage: node bridge-restart-idle.mjs [--idle-sec 12] [--max-min 20]

import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const DIR = join(DSH_HOME, 'tg-bridge');
const BRIDGE = join(DIR, 'bridge.mjs');
const PID_FILE = join(DIR, 'bridge.pid');
const RL = join(DIR, 'restart.log');

const argv = process.argv.slice(2);
const idleSec = Number(argv[argv.indexOf('--idle-sec') + 1]) || 12;
const maxMin = Number(argv[argv.indexOf('--max-min') + 1]) || 20;
const deadline = Date.now() + maxMin * 60000;

function log(line) {
  try {
    appendFileSync(RL, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {}
}

function runJson(script) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
    });
    return (out || '').trim();
  } catch {
    return '';
  }
}

function bridgePid() {
  const raw = runJson("try { (Get-Content '" + PID_FILE.replace(/'/g, "''") + "' -Raw).Trim() } catch { '' }");
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : 0;
}

/** Children of the bridge = the CLI process of one running turn. */
function runningTurns(pid) {
  const raw = runJson(
    `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | Where-Object { $_.Name -like 'DeepSeek Harness*' -and $_.CommandLine -match '--profile' } | Measure-Object | Select-Object -ExpandProperty Count`
  );
  return Number(raw) || 0;
}

async function main() {
  log(`v2 started: waiting for ${idleSec}s of idle`);
  let idleSince = 0;

  while (Date.now() < deadline) {
    const pid = bridgePid();
    if (!pid) {
      log('no bridge pid; nothing to restart');
      return;
    }
    const turns = runningTurns(pid);
    if (turns > 0) {
      idleSince = 0;
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (!idleSince) idleSince = Date.now();
    if (Date.now() - idleSince >= idleSec * 1000) {
      log(`idle ${idleSec}s with no running turn; restarting bridge ${pid}`);
      try {
        process.kill(pid, 'SIGTERM');
      } catch (error) {
        log(`kill failed: ${error.message}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
      const child = spawn(process.execPath, ['--dns-result-order=ipv4first', BRIDGE], {
        cwd: DIR,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      log(`started bridge pid ${child.pid}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  log('deadline reached; bridge left as is');
}

main().catch((error) => log(`fatal: ${error.message}`));
