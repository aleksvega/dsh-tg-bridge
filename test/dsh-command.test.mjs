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
  assert.match(out[0], /0\.2\.1-rc\.5/);
  assert.match(out[0], /restart DSH/);
});

test('a failed install quotes npm instead of pretending', async () => {
  const { ctx, out } = context('/dsh', 'update confirm');
  await handleDshCommands(ctx, deps({
    run: () => ({ status: 1, stderr: 'EACCES: permission denied, open /usr/lib' }),
  }));
  assert.match(out[0], /EACCES/);
  assert.doesNotMatch(out[0], /Installed/);
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

test('another command is left to its own handler', async () => {
  const { ctx } = context('/status');
  assert.equal(await handleDshCommands(ctx, deps()), false);
});