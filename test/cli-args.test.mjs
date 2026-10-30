// The order of `dsh` arguments is load-bearing: launcher options must come
// before app options, or the app sees `--patch` and refuses to boot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { turnArgs } from '../core/cli-args.mjs';

const base = { cli: 'cli.js', profile: 'headless', task: 'do the thing' };

test('launcher options come before app options', () => {
  const args = turnArgs({ ...base, extraArgs: ['--patch', 'vision.yml'] });
  const patch = args.indexOf('--patch');
  const json = args.indexOf('--json');
  assert.ok(patch > 0, 'patch flag present');
  assert.ok(json > patch, '--patch must precede --json, or the app rejects it');
  assert.equal(args[args.indexOf('vision.yml')], 'vision.yml');
});

test('a session id precedes the task and is omitted when unknown', () => {
  const withSession = turnArgs({ ...base, sessionId: 'session-1' });
  assert.equal(withSession[withSession.indexOf('--session-id') + 1], 'session-1');
  assert.equal(withSession.at(-1), 'do the thing');
  assert.ok(!turnArgs(base).includes('--session-id'));
});

test('the profile and the cli entrypoint are always present', () => {
  const args = turnArgs(base);
  assert.equal(args[args.indexOf('--profile') + 1], 'headless');
  assert.equal(args[1], 'cli.js');
  assert.equal(args.at(-1), 'do the thing');
});

test('bad input fails loudly', () => {
  assert.throws(() => turnArgs({ cli: 'cli.js', task: 'x' }), /profile/);
  assert.throws(() => turnArgs({ ...base, task: '' }), /task/);
  assert.throws(() => turnArgs({ ...base, cli: '' }), /cli/);
});
