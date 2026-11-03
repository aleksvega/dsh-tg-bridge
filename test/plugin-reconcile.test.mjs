// The plugin runs inside the host, so it can group the sessions the bridge
// created: the addendum on issue #3 named the shape, and this keeps it honest.
//
// The rules under test are the ones that decide whether a wrong group is
// possible: a session whose folder matches no workspace stays Ungrouped, a
// subagent is never grouped on its own, an id already listed is not touched, and
// a host without the two services is left quiet instead of broken.
import { strict as assert } from 'node:assert';
import test from 'node:test';

import { apply, reconcileOnce } from '../plugin-bridge.mjs';

const space = (id, path, attachable = true) => ({
  id,
  path,
  sessionIds: [],
  async attachSession(sessionId) {
    if (!attachable) throw new Error('not mine');
    if (sessionId.startsWith('other-')) throw new Error('folder mismatch');
    this.sessionIds.push(sessionId);
  },
});

const ctxOf = (spaces, sessions) => ({
  workspaceRegistry: { list: () => spaces },
  sessionPersistence: { list: async () => sessions.map((header) => ({ header })) },
});

test('a session created by a headless turn joins the workspace of its folder', async () => {
  const home = space('w1', 'C:/work/home');
  const ctx = ctxOf([home], [{ id: 'session-a', cwd: 'C:/work/home' }]);
  const out = await reconcileOnce(ctx);
  assert.deepEqual(out, { attached: 1, skipped: 0 });
  assert.deepEqual(home.sessionIds, ['session-a']);
});

test('a session in nobody\'s folder stays Ungrouped instead of being guessed', async () => {
  const home = space('w1', 'C:/work/home');
  const ctx = ctxOf([home], [{ id: 'other-1', cwd: 'C:/work/elsewhere' }]);
  const out = await reconcileOnce(ctx);
  assert.deepEqual(out, { attached: 0, skipped: 1 });
  assert.deepEqual(home.sessionIds, []);
});

test('a subagent is not a group member of its own', async () => {
  const home = space('w1', 'C:/work/home');
  const ctx = ctxOf([home], [
    { id: 'session-child', cwd: 'C:/work/home', parentSession: 'session-a' },
    { id: 'session-agent', cwd: 'C:/work/home', origin: 'subagent' },
  ]);
  const out = await reconcileOnce(ctx);
  assert.deepEqual(out, { attached: 0, skipped: 2 });
  assert.deepEqual(home.sessionIds, []);
});

test('an id already listed is left alone, and one id never lands twice', async () => {
  const home = space('w1', 'C:/work/home');
  home.sessionIds.push('session-a');
  const ctx = ctxOf([home], [
    { id: 'session-a', cwd: 'C:/work/home' },
    { id: 'session-b', cwd: 'C:/work/home' },
  ]);
  const out = await reconcileOnce(ctx);
  assert.deepEqual(out, { attached: 1, skipped: 0 });
  assert.deepEqual(home.sessionIds, ['session-a', 'session-b']);
});

test('the first workspace that accepts the id keeps it, the rest are not asked', async () => {
  let asked = 0;
  const first = { id: 'w1', path: 'C:/one', sessionIds: [], attachSession: async () => { asked += 1; throw new Error('no'); } };
  const second = space('w2', 'C:/work/home');
  const ctx = ctxOf([first, second], [{ id: 'session-a', cwd: 'C:/work/home' }]);
  const out = await reconcileOnce(ctx);
  assert.equal(asked, 1);
  assert.deepEqual(out, { attached: 1, skipped: 0 });
  assert.deepEqual(second.sessionIds, ['session-a']);
});

test('a host without the workspace services is quiet, not broken', async () => {
  assert.deepEqual(await reconcileOnce({}), { attached: 0, skipped: 0, reason: 'no-services' });
  assert.deepEqual(await reconcileOnce(undefined), { attached: 0, skipped: 0, reason: 'no-services' });
  assert.deepEqual(
    await reconcileOnce({ workspaceRegistry: { list: () => [] } }),
    { attached: 0, skipped: 0, reason: 'no-services' },
  );
});

test('a persistence entry with no header shape is skipped, not crashed on', async () => {
  const home = space('w1', 'C:/work/home');
  const ctx = {
    workspaceRegistry: { list: () => [home] },
    sessionPersistence: { list: async () => [null, {}, { header: null }, { header: { cwd: 'C:/work/home' } }] },
  };
  const out = await reconcileOnce(ctx);
  assert.deepEqual(out, { attached: 0, skipped: 0 });
  assert.deepEqual(home.sessionIds, []);
});

test('a host that refuses an undeclared service does not fail the plugin', async () => {
  // Cordis only answers for the names an entry declares in `inject`, and throws
  // on the rest: a live boot failed exactly this way ("cannot get property
  // workspaceRegistry without inject") and the entry never activated, so the
  // bridge was not started at all. The guard has to survive the throw.
  const strict = () => {
    const ctx = {};
    for (const name of ['workspaceRegistry', 'sessionPersistence']) {
      Object.defineProperty(ctx, name, {
        get() {
          throw new Error(`cannot get property "${name}" without inject`);
        },
      });
    }
    return ctx;
  };
  assert.deepEqual(await reconcileOnce(strict()), { attached: 0, skipped: 0, reason: 'no-services' });
  assert.doesNotThrow(() => apply(strict(), { autoStart: false }));
});