// The watchdog in front of every press and every command.
//
// What it has to prove is the property the person asked for: there is no path
// through a press that ends in silence. Either the handler says something, or
// the guard says it for them — once, and never twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { QUIET_MS, quietGuard } from '../chat/quiet-guard.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('an answer inside the window keeps the guard quiet', async () => {
  let notices = 0;
  const guard = quietGuard({ ms: 20, onSlow: () => (notices += 1) });
  const say = guard.wrap(() => 'sent');
  assert.equal(say('hi'), 'sent');
  assert.equal(guard.spoke(), true);
  await wait(40);
  assert.equal(notices, 0);
  guard.cancel();
});

test('nothing said means exactly one notice, after the window', async () => {
  let notices = 0;
  const guard = quietGuard({ ms: 20, onSlow: (waited) => (notices += waited >= 0 ? 1 : 0) });
  assert.equal(guard.firing(), false);
  await wait(45);
  assert.equal(notices, 1);
  assert.equal(guard.firing(), true);
  // Time passing again must not repeat it: one press, one line.
  await wait(30);
  assert.equal(notices, 1);
});

test('marking an output that went another way also counts', async () => {
  let notices = 0;
  const guard = quietGuard({ ms: 20, onSlow: () => (notices += 1) });
  guard.mark();
  await wait(45);
  assert.equal(notices, 0);
});

test('a wrapped function keeps its arguments and its return value', async () => {
  const guard = quietGuard({ ms: 1000, onSlow: () => {} });
  const send = (chat, text, thread) => ({ chat, text, thread });
  const wrapped = guard.wrap(send);
  assert.deepEqual(wrapped(1, 'x', 7), { chat: 1, text: 'x', thread: 7 });
  guard.cancel();
});

test('cancel stops the notice: a command that turned into a turn is not a hang', async () => {
  let notices = 0;
  const guard = quietGuard({ ms: 20, onSlow: () => (notices += 1) });
  guard.cancel();
  await wait(45);
  assert.equal(notices, 0);
  assert.equal(guard.firing(), false);
});

test('a notifier that throws does not become the failure', async () => {
  const guard = quietGuard({
    ms: 10,
    onSlow: () => {
      throw new Error('telegram is down');
    },
  });
  await wait(30);
  // Reaching here at all is the assertion: the throw was swallowed by the guard.
  assert.equal(guard.firing(), true);
});

test('the default window is long enough to be a hang, short enough to notice', () => {
  assert.ok(QUIET_MS >= 30_000, 'a fast press must never trip the guard');
  assert.ok(QUIET_MS <= 120_000, 'a hung press must not wait minutes for its line');
});
