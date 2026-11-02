// The two questions /doctor could not answer: is the supervisor still ticking,
// and did a restart marker outlive its restart.
//
// `core/state.mjs` reads DSH_HOME at import time, so the fixture for the corrupt
// case has to exist before the dynamic import. Each test file runs in its own
// process, which is what makes that safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeAge, supervisionRows } from '../control/doctor-rows.mjs';
import { awaitPid } from '../core/start-guard.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

test('an age reads as seconds, minutes, hours or days, never as a raw number', () => {
  assert.equal(describeAge(0), '0s');
  assert.equal(describeAge(4_000), '4s');
  assert.equal(describeAge(89_000), '89s', 'under a minute and a half stays in seconds');
  assert.equal(describeAge(90_000), '2m');
  assert.equal(describeAge(12 * 60_000), '12m');
  assert.equal(describeAge(50 * 60_000), '50m', 'past 45 minutes the unit is still minutes');
  assert.equal(describeAge(3_600_000), '1h', 'an hour is an hour, not "60m"');
  assert.equal(describeAge(5 * 3_600_000), '5h');
  assert.equal(describeAge(40 * 3_600_000), '2d', 'two days is already days');
  assert.equal(describeAge(Number.NaN), '0s', 'a missing mtime is not "-Infinitys"');
});

test('the supervision rows read the marker and the supervisor log off disk', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-supervision-'));
  const dir = join(home, 'tg-bridge');
  mkdirSync(dir, { recursive: true });

  // Nothing on disk yet: no marker, and a supervisor that never ran.
  const cold = supervisionRows('en', home).join('\n');
  assert.match(cold, /Restart marker: none/);
  assert.match(cold, /Supervisor: no tick yet/);

  writeFileSync(join(dir, 'restart.pending'), '{"chatId":1}', 'utf8');
  writeFileSync(join(dir, 'kick.log'), 'started\n', 'utf8');
  const warm = supervisionRows('en', home).join('\n');
  assert.match(warm, /Restart marker: set 0s ago/);
  assert.match(warm, /Supervisor: last tick 0s ago/);

  // A marker from an hour ago is exactly what a dead supervisor leaves behind.
  const past = new Date(Date.now() - 3_600_000);
  utimesSync(join(dir, 'restart.pending'), past, past);
  utimesSync(join(dir, 'kick.log'), past, past);
  const stale = supervisionRows('ru', home).join('\n');
  assert.match(stale, /Метка рестарта: висит 1h/);
  assert.match(stale, /Супервизор: последний тик 1h назад/);
});

// The tick itself: a marker with a live pid is a leftover, not news.
//
// `bridge.pid` names this test process, which is alive by definition, so the
// tick takes its cheap "bridge is healthy" path and never spawns anything — no
// real bridge, no Telegram, no port. That is the path the marker bug lived on.
function tick(home) {
  return spawnSync(process.execPath, [join(ROOT, 'bridge-kick.mjs')], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, DSH_HOME: home },
    timeout: 60_000,
  });
}

function kickHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-kick-'));
  const dir = join(home, 'tg-bridge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bridge.mjs'), '// stand-in: the tick only checks it exists\n', 'utf8');
  writeFileSync(join(dir, 'bridge.pid'), String(process.pid), 'utf8');
  return { home, dir };
}

test('a restart marker older than ten minutes is cleared, with one log line', () => {
  const { home, dir } = kickHome();
  const marker = join(dir, 'restart.pending');
  writeFileSync(marker, '{}', 'utf8');
  const old = new Date(Date.now() - 11 * 60_000);
  utimesSync(marker, old, old);

  const result = tick(home);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(marker), false, 'a stale marker must not survive the tick');
  const log = readFileSync(join(dir, 'kick.log'), 'utf8');
  assert.match(log, /cleared stale restart marker \(6\d\ds old, bridge alive\)/);
});

test('a fresh marker is left alone: a restart really is in progress', () => {
  const { home, dir } = kickHome();
  const marker = join(dir, 'restart.pending');
  writeFileSync(marker, '{}', 'utf8');

  const result = tick(home);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(marker), true, 'a marker written seconds ago is not stale');
  assert.match(readFileSync(join(dir, 'kick.log'), 'utf8'), /restart still in progress/);
});

test('a corrupt state.json is kept as .bad, logged, and does not stop the bridge', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-state-'));
  const dir = join(home, 'tg-bridge');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), '{"sessions": {', 'utf8');
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { state } = await import(`../core/state.mjs?corrupt=${Date.now()}`);
    assert.deepEqual(state, { offset: 0, sessions: {} }, 'an empty state, not a crash');
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
  }
  assert.equal(readFileSync(join(dir, 'state.json.bad'), 'utf8'), '{"sessions": {', 'the file that broke is the evidence');
  assert.match(readFileSync(join(dir, 'bridge.log'), 'utf8'), /state unreadable: .*kept as state\.json\.bad/);
});

// ------------------------------------------------------- two ticks, one bridge

test('the wait ends when a pid appears, when the child dies, or at the deadline', async () => {
  const calls = [];
  const sleep = async (ms) => calls.push(ms);
  let clock = 0;
  const now = () => clock;

  // The pid shows up on the third look: true, and it did wait for it.
  const seen = [0, 0, 4242];
  let look = 0;
  assert.equal(await awaitPid({
    readPid: () => seen[Math.min(look++, seen.length - 1)],
    isAlive: () => true,
    childPid: 7,
    limit: 10_000,
    sleep,
    now,
  }), true);

  // A child that exited will never write one: stop at once, do not burn the
  // whole deadline on a bridge that is already gone.
  calls.length = 0;
  clock = 0;
  assert.equal(await awaitPid({
    readPid: () => 0,
    isAlive: (pid) => pid !== 7,
    childPid: 7,
    limit: 10_000,
    sleep: async () => { clock += 100; },
    now,
  }), false);
  assert.equal(clock, 0, 'a dead child is known before the first sleep');
});

test('two ticks a moment apart start exactly one bridge', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-race-'));
  const dir = join(home, 'tg-bridge');
  mkdirSync(dir, { recursive: true });
  // A stub bridge that takes 600 ms to write its pid, which is the window the
  // second tick used to fall into. It records every start, so a double start is
  // visible as two lines rather than inferred from a log message.
  writeFileSync(join(dir, 'bridge.mjs'), [
    "import { appendFileSync, writeFileSync } from 'node:fs';",
    "appendFileSync(new URL('./spawns.log', import.meta.url), `${process.pid}\\n`);",
    'await new Promise((resolve) => setTimeout(resolve, 600));',
    "writeFileSync(new URL('./bridge.pid', import.meta.url), String(process.pid));",
    '',
  ].join('\n'), 'utf8');

  const env = { ...process.env, DSH_HOME: home };
  const first = spawn(process.execPath, [join(ROOT, 'bridge-kick.mjs')], { env, stdio: 'ignore', windowsHide: true });
  const firstDone = new Promise((resolve) => first.on('exit', resolve));
  await new Promise((resolve) => setTimeout(resolve, 150));
  // Blocking on purpose: the second tick must run while the first still holds
  // the lock, which is the situation the lock exists for.
  const second = tick(home);
  await firstDone;
  await new Promise((resolve) => setTimeout(resolve, 1_500));

  const spawns = existsSync(join(dir, 'spawns.log'))
    ? readFileSync(join(dir, 'spawns.log'), 'utf8').trim().split(/\r?\n/).filter(Boolean)
    : [];
  assert.equal(spawns.length, 1, `two ticks started ${spawns.length} bridges`);
  assert.equal(second.status, 0, second.stderr);
  const log = readFileSync(join(dir, 'kick.log'), 'utf8');
  assert.match(log, /restart in progress .*skipping this tick/, 'the second tick must back off, not race');
  assert.match(log, /start issued pid=/);
});