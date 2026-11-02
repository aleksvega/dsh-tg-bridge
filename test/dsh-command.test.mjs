// `/dsh` answers three questions with three different reliability levels, and
// the card must not blur them: an unknown latest is not "up to date", and a
// version outside the tested range is not "broken". The tests pin the wording of
// both distinctions, and pin that installing needs a second, explicit word.
import assert from 'node:assert/strict';
import test from 'node:test';

import { handleDshCommands } from '../control/cmd-dsh.mjs';

function context(command, arg = '', lang = 'en') {
  const out = [];
  const extras = [];
  return {
    ctx: {
      effective: command,
      arg,
      lang,
      reply: (text, extra) => {
        out.push(String(text));
        extras.push(extra || {});
        return 1;
      },
      log: () => {},
    },
    out,
    extras,
  };
}

const deps = (overrides = {}) => ({
  installed: () => '0.2.1-rc.3',
  latest: async () => '0.2.1-rc.5',
  forget: () => {},
  // These tests describe an install whose CLI belongs to npm, which is what
  // Linux and a user-set DSH_BIN look like. The app-owned case is a separate
  // pair of tests below, because on it the npm command is not the answer at all.
  kind: 'cli',
  ...overrides,
});

test('the card names both versions and the range it was tested with', async () => {
  const { ctx, out } = context('/dsh');
  assert.equal(await handleDshCommands(ctx, deps()), true);
  assert.match(out[0], /0\.2\.1-rc\.3/);
  assert.match(out[0], /0\.2\.1-rc\.5/);
  assert.match(out[0], />=0\.2\.1-rc\.2 <0\.3\.0-0/);
  assert.match(out[0], /Update: \/dsh update/, 'behind, so the hint is there');
});

test('an unknown latest never reads as up to date', async () => {
  const { ctx, out } = context('/dsh');
  await handleDshCommands(ctx, deps({ latest: async () => '' }));
  assert.match(out[0], /npm did not say/);
  assert.doesNotMatch(out[0], /Update:/);
});

test('a version nobody tested warns without blocking', async () => {
  const { ctx, out } = context('/dsh');
  await handleDshCommands(ctx, deps({ installed: () => '0.3.0', latest: async () => '0.3.0' }));
  assert.match(out[0], /Outside the range/);
  assert.match(out[0], /may still work/);
  assert.doesNotMatch(out[0], /Update:/, 'there is nothing newer to offer');
});

test('an unreadable installed version says so instead of printing a blank', async () => {
  const { ctx, out } = context('/dsh');
  await handleDshCommands(ctx, deps({ installed: () => '' }));
  assert.match(out[0], /could not read/);
  assert.doesNotMatch(out[0], /DSH {2}\(/);
});

test('updating prints the exact command and runs nothing until confirm', async () => {
  let ran = 0;
  const { ctx, out } = context('/dsh', 'update');
  await handleDshCommands(ctx, deps({ run: () => { ran += 1; return { status: 0 }; } }));
  assert.match(out[0], /npm i -g @deepseek-ai\/dsh@0\.2\.1-rc\.5/);
  assert.match(out[0], /confirm/);
  assert.equal(ran, 0, 'the plan must not install anything');
});

test('confirm installs, re-reads the version and names the restart', async () => {
  const calls = [];
  let forgotten = 0;
  const { ctx, out } = context('/dsh', 'update confirm');
  await handleDshCommands(ctx, deps({
    installed: ({ fresh } = {}) => (fresh ? '0.2.1-rc.5' : '0.2.1-rc.3'),
    run: (...args) => {
      calls.push(args);
      return { status: 0 };
    },
    forget: () => {
      forgotten += 1;
    },
  }));
  assert.equal(forgotten, 1, 'the cached version has to be re-read after install');
  assert.deepEqual(calls[0].slice(0, 1), ['npm']);
  assert.deepEqual(calls[0][1].slice(0, 2), ['i', '-g']);
  // Index 0 is the "installing, the bridge keeps answering" line that keeps the
  // poll loop free; the result lands behind it.
  assert.match(out[1], /0\.2\.1-rc\.5/);
  assert.match(out[1], /restart DSH/);
});

test('a failed install quotes npm instead of pretending', async () => {
  const { ctx, out } = context('/dsh', 'update confirm');
  await handleDshCommands(ctx, deps({
    run: () => ({ status: 1, stderr: 'EACCES: permission denied, open /usr/lib' }),
  }));
  assert.match(out[1], /EACCES/);
  assert.doesNotMatch(out.join('\n'), /Installed/);
});

test('no latest means nothing to install, said plainly', async () => {
  const { ctx, out } = context('/dsh', 'update confirm');
  await handleDshCommands(ctx, deps({ latest: async () => '' }));
  assert.match(out[0], /nothing to install/);
});

test('the card offers the update as a button, not as a spelling lesson', async () => {
  const behind = context('/dsh');
  await handleDshCommands(behind.ctx, deps());
  assert.equal(behind.extras[0].keyboard[0][0].data, 'ds:update');
  assert.match(behind.extras[0].keyboard[0][0].text, /0\.2\.1-rc\.5/);

  const current = context('/dsh');
  await handleDshCommands(current.ctx, deps({ installed: () => '0.2.1-rc.5' }));
  assert.equal(current.extras[0].keyboard, undefined, 'nothing to update, no button to press');

  const plan = context('/dsh', 'update');
  await handleDshCommands(plan.ctx, deps());
  assert.equal(plan.extras[0].keyboard[0][0].data, 'ds:confirm');
});

test('an unknown word gets the usage line, in every language', async () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const { ctx, out } = context('/dsh', 'whatever', lang);
    assert.equal(await handleDshCommands(ctx, deps()), true);
    assert.match(out[0], /\/dsh update confirm/, `${lang} must name the words it knows`);
  }
});

// The app-owned CLI is the case that made `/dsh update` a lie on the machine it
// was written on: `dsh` on PATH is the desktop app's own bundled CLI, so
// `npm i -g` installed a second copy under npm's prefix, changed nothing a turn
// launches, and the card then re-read the app's version and reported success.
test('a CLI owned by the app says so, and offers no npm button', async () => {
  const { ctx, out, extras } = context('/dsh');
  await handleDshCommands(ctx, deps({ kind: 'app' }));
  assert.match(out[0], /belongs to the DeepSeek Harness app/);
  assert.match(out[0], /updates with the app/);
  assert.doesNotMatch(out[0], /Update: \/dsh update/, 'the npm route cannot help this CLI');
  assert.equal(extras[0].keyboard, undefined, 'a button that cannot do the job is a lie');
});

test('an app-owned CLI with no readable version names the app, not a bad install', async () => {
  const { ctx, out } = context('/dsh', '', 'en');
  await handleDshCommands(ctx, deps({ kind: 'app', installed: () => '' }));
  assert.match(out[0], /from the desktop app/, 'the app is the launcher');
  assert.match(out[0], /npm is not involved/);
  assert.doesNotMatch(out[0], /could not read|may not be installed/, 'nothing is misplaced here');
});

test('updating an app-owned CLI refuses instead of installing a copy nobody runs', async () => {
  for (const lang of ['en', 'ru', 'zh']) {
    let ran = 0;
    const { ctx, out, extras } = context('/dsh', 'update confirm', lang);
    await handleDshCommands(ctx, deps({
      kind: 'app',
      run: () => {
        ran += 1;
        return { status: 0 };
      },
    }));
    assert.equal(ran, 0, `${lang}: npm must not run for the app's own CLI`);
    assert.equal(out.length, 1, `${lang}: one message, and it is the refusal`);
    assert.equal(extras[0].keyboard, undefined, `${lang} must not offer a confirm button`);
  }
});

test('a real install says it is running before it says it is done', async () => {
  const { ctx, out } = context('/dsh', 'update confirm');
  await handleDshCommands(ctx, deps({
    installed: ({ fresh } = {}) => (fresh ? '0.2.1-rc.5' : '0.2.1-rc.3'),
    run: () => ({ status: 0 }),
  }));
  // The first message is the promise that the bot is still alive: npm can take
  // minutes, and the poll loop must not be the thing that waits for it.
  assert.match(out[0], /Installing 0\.2\.1-rc\.5 through npm/);
  assert.match(out[0], /keeps answering/);
  assert.match(out[1], /0\.2\.1-rc\.5/);
  assert.match(out[1], /restart DSH/);
});

test('another command is left to its own handler', async () => {
  const { ctx } = context('/status');
  assert.equal(await handleDshCommands(ctx, deps()), false);
});