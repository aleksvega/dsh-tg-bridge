// How a turn starts: which binary, and what goes before `--profile`.
//
// This was Windows-only for a long time, and the README said otherwise. The
// bridge is fine on macOS and Linux — the plugin commands already fall back to
// `dsh` on PATH — but the one thing that matters most, the turn runner, spawned
// the Electron app by an absolute Windows path. The fix is a resolver, not a
// branch in three files: one place decides, and every caller asks it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dshLaunch } from '../dsh-launch.mjs';

// The app binary, whatever it is called on this platform: an `.exe`, not the
// `dsh` command. The product name is not asserted — a rename is not a bug, and
// a test that pins the marketing name is a test that breaks for no reason.
const WIN_EXE = /\.exe$/i;

test('on Windows a turn runs the app binary with the CLI entrypoint', () => {
  const launch = dshLaunch({ platform: 'win32', env: {} });
  assert.equal(launch.kind, 'app');
  assert.match(launch.exe, WIN_EXE);
  // The Electron binary is not a CLI: it needs `--expose-internals <cli.js>`
  // before any app flag, or it opens a window instead of running a turn.
  assert.equal(launch.lead[0], '--expose-internals');
  assert.match(launch.lead[1], /cli\.js$/);
});

test('on macOS and Linux a turn runs the dsh command, not a Windows path', () => {
  for (const platform of ['darwin', 'linux']) {
    const launch = dshLaunch({ platform, env: {}, exists: () => false });
    assert.equal(launch.kind, 'cli', `${platform} should not use the Windows app`);
    assert.equal(launch.exe, 'dsh', `${platform} should run the command on PATH`);
    // No entrypoint argument: `dsh` already IS the entrypoint, and passing the
    // Electron-only flag to it is how a turn dies with "unknown option".
    assert.deepEqual(launch.lead, []);
    assert.doesNotMatch(launch.exe, WIN_EXE);
  }
});

test('the macOS bundle is used when it is really installed', () => {
  const launch = dshLaunch({ platform: 'darwin', env: {}, exists: () => true });
  assert.equal(launch.kind, 'app');
  // Inside the bundle, not at the `.app` itself: the executable lives in
  // Contents/MacOS and the CLI entrypoint in Contents/Resources.
  assert.match(launch.exe, /\.app[\\/]Contents[\\/]MacOS[\\/]/);
  assert.match(launch.lead[1], /\.app[\\/]Contents[\\/]Resources[\\/].*cli\.js$/);
  // ...and is not guessed at when the path is not there: a spawn that fails with
  // ENOENT teaches nobody anything, so the PATH form wins by default.
  assert.equal(dshLaunch({ platform: 'darwin', env: {}, exists: () => false }).kind, 'cli');
});

test('an explicit override beats every guess', () => {
  // A checkout, a moved app, a system package: the person knows where it is.
  const viaCli = dshLaunch({ platform: 'linux', env: { DSH_CLI_JS: '/opt/dsh/cli.js' } });
  assert.equal(viaCli.why, 'DSH_CLI_JS');
  assert.equal(viaCli.lead[1], '/opt/dsh/cli.js');
  // A bare binary needs no entrypoint, whatever the platform.
  const viaBin = dshLaunch({ platform: 'win32', env: { DSH_BIN: '/usr/local/bin/dsh' } });
  assert.equal(viaBin.why, 'DSH_BIN');
  assert.equal(viaBin.exe, '/usr/local/bin/dsh');
  assert.deepEqual(viaBin.lead, []);
  // Windows still defaults to the app when nothing is set, so an ordinary
  // install is not affected by this module existing.
  assert.equal(dshLaunch({ platform: 'win32', env: {} }).why, 'windows app');
});
