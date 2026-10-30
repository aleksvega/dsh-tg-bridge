// restart-after-send — restart the bridge only AFTER it has delivered the
// current reply.
//
// The trap that cost hours: restarting the bridge from inside an agent turn
// kills that very turn, so the answer is never sent and the chat looks dead.
// This helper waits for the next "sent chat=" line in the log (proof that the
// pending reply went out), then swaps in the new code.
//
// Usage: node restart-after-send.mjs [--max-wait-min 10]

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const DIR = join(DSH_HOME, 'tg-bridge');
const BRIDGE = join(DIR, 'bridge.mjs');
const LOG = join(DIR, 'bridge.log');
const RL = join(DIR, 'restart.log');
const PID = join(DIR, 'bridge.pid');
const NODE = process.execPath;

const args = process.argv.slice(2);
const maxWaitMin = Number((args[args.indexOf('--max-wait-min') + 1] ?? 10)) || 10;
const deadline = Date.now() + maxWaitMin * 60000;

const log = (line) => {
  try {
    appendFileSync(RL, `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {}
};

const sizeOf = () => {
  try {
    return readFileSync(LOG, 'utf8').length;
  } catch {
    return 0;
  }
};

const startSize = sizeOf();
log(`waiting for the pending reply to be delivered (log offset ${startSize})`);

/** Bridge PIDs. */
function bridgePids() {
  const r = spawn('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'bridge\\.mjs' } | Select-Object -ExpandProperty ProcessId",
  ], { windowsHide: true });
  let out = '';
  r.stdout.on('data', (buf) => { out += buf; });
  r.stderr.on('data', () => {});
  return new Promise((resolve) => {
    r.on('close', () => {
      resolve(out.split(/\r?\n/).map((v) => Number(v.trim())).filter((v) => Number.isInteger(v) && v > 0));
    });
  });
}

async function waitForDelivery() {
  while (Date.now() < deadline) {
    const text = (() => {
      try {
        return readFileSync(LOG, 'utf8');
      } catch {
        return '';
      }
    })();
    const fresh = text.slice(startSize);
    if (/sent chat=/.test(fresh)) {
      log('reply delivered; restarting');
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  log('deadline reached without a delivery; restarting anyway');
  return false;
}

async function restart() {
  // Let the send call fully settle before killing the process that owns it.
  await new Promise((resolve) => setTimeout(resolve, 4000));
  for (const pid of await bridgePids()) {
    try {
      process.kill(pid);
      log(`stopped bridge ${pid}`);
    } catch (error) {
      log(`could not stop ${pid}: ${error.message}`);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 2500));
  if (!existsSync(BRIDGE)) {
    log('bridge.mjs missing; aborting');
    return;
  }
  const child = spawn(NODE, ['--dns-result-order=ipv4first', BRIDGE], {
    cwd: DIR,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  log(`started bridge pid ${child.pid}`);
  await new Promise((resolve) => setTimeout(resolve, 6000));
  try {
    const pidNow = Number(readFileSync(PID, 'utf8').trim());
    log(`confirmed pid file ${pidNow}`);
  } catch {
    log('pid file not written yet');
  }
}

await waitForDelivery();
await restart();
process.exit(0);
