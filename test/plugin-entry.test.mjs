// The plugin entry point had no test: the package declared a bundle in
// `package.json`, the marketplace listed it, and nothing proved the entry did
// what the marketplace entry claims. These tests exercise the guards that keep
// the plugin from starting a second poller -- the one failure that is invisible
// in a test suite and very visible in Telegram (409 conflict, two answers).
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { apply, inject, name, runningPid, startBridge } from '../plugin-bridge.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function scratch({ config = true, pid = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-'));
  if (config) writeFileSync(join(dir, 'config.json'), '{"token":"test"}');
  if (pid !== null) writeFileSync(join(dir, 'bridge.pid'), String(pid));
  return dir;
}

function recorder(pid = 4242) {
  const calls = [];
  const spawnImpl = (execPath, args, options) => {
    calls.push({ execPath, args, options });
    return {
      pid,
      unref() {
        calls.unrefd = true;
      },
    };
  };
  return { calls, spawnImpl };
}

test('the entry is the service the bundle patch inserts', () => {
  const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  assert.equal(name, 'tg-bridge');
  assert.deepEqual(inject, [], 'the entry needs nothing injected before it runs');
  assert.match(patch, /- id: tg-bridge/, 'the patch names the id the code exports');
  assert.ok(patch.includes(`name: ${pkg.name}`), 'the patch inserts this package by its npm name');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.ok(pkg.files.includes('plugin-bridge.mjs'), 'the entry ships, or the package installs without it');
});

test('the marketplace gate reads engines.dsh, so the range must be there', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.engines.dsh, />=0\.2\.1-rc\.\d+ <0\.3\.0-0/, 'a plain <0.3.0 would exclude prereleases');
});

test('nothing starts before a token exists', () => {
  const dir = scratch({ config: false });
  const { calls, spawnImpl } = recorder();
  assert.deepEqual(startBridge({ dir, spawnImpl }), { started: false, reason: 'unconfigured' });
  assert.equal(calls.length, 0);
});

test('a live bridge pid wins over the plugin', () => {
  const dir = scratch({ pid: process.pid });
  const { calls, spawnImpl } = recorder();
  assert.equal(runningPid(dir), process.pid);
  assert.deepEqual(startBridge({ dir, spawnImpl }), { started: false, reason: 'running' });
  assert.equal(calls.length, 0);
});

test('a pid that no longer exists does not block the start', () => {
  const dir = scratch({ pid: 999999 });
  const { calls, spawnImpl } = recorder();
  assert.equal(runningPid(dir), 0, 'a dead pid is not a running bridge');
  assert.equal(startBridge({ dir, spawnImpl }).started, true);
  assert.equal(calls.length, 1);
  assert.equal(existsSync(join(dir, 'plugin-start.lock')), false, 'the lock is released after the start');
});

test('the start lock keeps two profiles from spawning twice', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'plugin-start.lock'), 'another profile');
  const { calls, spawnImpl } = recorder();
  assert.deepEqual(startBridge({ dir, spawnImpl }), { started: false, reason: 'locked' });
  assert.equal(calls.length, 0);
});

test('the child is detached, silent, and killed on dispose', () => {
  const dir = scratch();
  const ctx = { on(event, fn) { ctx.handlers ??= {}; ctx.handlers[event] = fn; } };
  const { calls, spawnImpl } = recorder(424242);

  const result = startBridge({
    dir,
    ctx,
    spawnImpl,
    execPath: 'node',
    script: '/tmp/bridge.mjs',
    env: { MARKER: 'kept' },
  });

  assert.equal(result.started, true);
  assert.equal(result.pid, 424242);
  const [call] = calls;
  assert.equal(call.execPath, 'node');
  assert.deepEqual(call.args, ['/tmp/bridge.mjs']);
  assert.equal(call.options.cwd, dir, 'the bridge resolves its config from the directory it was told');
  assert.equal(call.options.detached, true, 'a harness shutdown must not take the bridge with it');
  assert.equal(call.options.stdio, 'ignore');
  assert.equal(call.options.env.MARKER, 'kept');
  assert.equal(calls.unrefd, true, 'the host must be able to exit without waiting for the bridge');
  assert.equal(typeof ctx.handlers.dispose, 'function');

  const real = process.kill;
  const killed = [];
  process.kill = (pid, signal) => {
    if (signal === 0) return true;
    killed.push(pid);
    return true;
  };
  try {
    ctx.handlers.dispose();
  } finally {
    process.kill = real;
  }
  assert.deepEqual(killed, [424242], 'dispose stops the process it started');
});

test('a spawn that throws is reported, not swallowed as success', () => {
  const dir = scratch();
  const spawnImpl = () => {
    throw new Error('refused');
  };
  assert.deepEqual(startBridge({ dir, spawnImpl }), { started: false, reason: 'spawn-failed' });
  assert.equal(existsSync(join(dir, 'plugin-start.lock')), false);
});

test('a spawn that returns no pid is a failure, not a start', () => {
  const dir = scratch();
  assert.deepEqual(startBridge({ dir: dir, spawnImpl: () => ({}) }), { started: false, reason: 'spawn-failed' });
});

test('autoStart false keeps the plugin out of the way', () => {
  assert.deepEqual(apply({ on() {} }, { autoStart: false }), { started: false, reason: 'disabled' });
});

test('two profiles starting at once produce one process, not two', () => {
  // The lock is a file created with 'wx': the second open fails and the second
  // profile returns without spawning. Simulated by holding the lock.
  const dir = scratch();
  const first = recorder(11);
  const second = recorder(22);
  assert.equal(startBridge({ dir, spawnImpl: first.spawnImpl }).started, true);

  writeFileSync(join(dir, 'plugin-start.lock'), 'held');
  assert.deepEqual(startBridge({ dir, spawnImpl: second.spawnImpl }), { started: false, reason: 'locked' });
  assert.equal(second.calls.length, 0, 'the second profile must not spawn');
});
