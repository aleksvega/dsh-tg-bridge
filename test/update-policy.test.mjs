import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UPDATE_MODES, compareVersions, checkIntervalMs, describeUpdate, dueForCheck, modeChange, updateState } from '../core/update-policy.mjs';

test('versions compare numerically, not as text', () => {
  assert.equal(compareVersions('1.13.2', '1.9.0'), 1); // string compare would say otherwise
  assert.equal(compareVersions('1.13.0', '1.13.0'), 0);
  assert.equal(compareVersions('1.2.10', '1.2.9'), 1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('1.13.1-beta.1', '1.13.0'), 1);
});

test('a newer release behind a mode that notices', () => {
  const s = updateState({ installed: '1.13.0', latest: '1.13.2', mode: 'check' });
  assert.equal(s.behind, true);
  assert.equal(s.notify, true);
  assert.equal(s.auto, false);
});

test('one notice per version, none for the version already running', () => {
  assert.equal(updateState({ installed: '1.13.0', latest: '1.13.2', notified: '1.13.2' }).notify, false);
  assert.equal(updateState({ installed: '1.13.2', latest: '1.13.2' }).notify, false);
  assert.equal(updateState({ installed: '1.13.0', latest: '1.13.2', notified: '1.12.0' }).notify, true);
});

test('off means no notice and no automatic work, but the number is still known', () => {
  const s = updateState({ installed: '1.13.0', latest: '1.13.2', mode: 'off' });
  assert.equal(s.behind, true);
  assert.equal(s.notify, false);
  assert.equal(s.auto, false);
  assert.match(describeUpdate(s), /notices are off/);
});

test('auto updates, and says a restart is what loads it', () => {
  const s = updateState({ installed: '1.13.0', latest: '1.13.2', mode: 'auto' });
  assert.equal(s.auto, true);
  assert.match(describeUpdate(s), /restart/);
});

test('an unreachable registry promises nothing', () => {
  const s = updateState({ installed: '1.13.0', latest: '', mode: 'auto' });
  assert.equal(s.behind, false);
  assert.equal(s.notify, false);
  assert.equal(s.auto, false);
  assert.match(describeUpdate(s), /did not answer/);
});

test('an unknown mode falls back to check instead of going silent or eager', () => {
  assert.equal(updateState({ mode: 'yolo' }).mode, 'check');
  assert.equal(updateState({ mode: '' }).mode, 'check');
});

test('checking is sparse, and never in off', () => {
  assert.equal(checkIntervalMs('off'), 0);
  assert.ok(checkIntervalMs('auto') < checkIntervalMs('check'));
  const now = 1_000_000_000;
  assert.equal(dueForCheck({ mode: 'off', checkedAt: 0, now }), false);
  assert.equal(dueForCheck({ mode: 'check', checkedAt: now - 1000, now }), false);
  assert.equal(dueForCheck({ mode: 'check', checkedAt: now - checkIntervalMs('check'), now }), true);
  assert.equal(dueForCheck({ mode: 'auto', checkedAt: now - checkIntervalMs('check'), now }), true);
});

test('the mode list is the one the command accepts', () => {
  assert.deepEqual(UPDATE_MODES, ['off', 'check', 'auto']);
});

test('off stops the notices and leaves the version alone', () => {
  const r = modeChange({ installed: '1.13.2', latest: '1.14.0', command: 'off' });
  assert.equal(r.store.mode, 'off');
  // Neither switch installs: `off` is the notice, `confirm` is the install, so
  // the pin records where a person is stuck but does not mark anything read.
  assert.equal(r.store.pinned, '1.13.2');
  assert.equal(r.store.notified, undefined);
  assert.equal(updateState({ installed: '1.13.2', latest: '1.15.0', mode: r.store.mode }).notify, false);
});

test('auto and off never install on their own switch', () => {
  // `auto` on a lagging install is allowed: the next check does the work.
  const r = modeChange({ installed: '1.13.0', latest: '1.14.0', command: 'auto' });
  assert.equal(r.store.mode, 'auto');
  assert.equal(r.store.pinned, '');
  // And switching from `off` to `on` goes through `check`, not straight to work.
  assert.equal(modeChange({ installed: '1.13.0', latest: '1.14.0', command: 'on' }).store.mode, 'check');
});

test('manual pins the version and still answers /update confirm', () => {
  const r = modeChange({ installed: '1.13.2', latest: '1.14.0', command: 'manual' });
  assert.equal(r.store.mode, 'check');
  assert.equal(r.store.pinned, '1.13.2');
  assert.match(r.text, /stays on 1\.13\.2/);
});

test('auto is accepted on an up-to-date install, and from off', () => {
  assert.equal(modeChange({ installed: '1.13.2', latest: '1.13.2', command: 'auto' }).store.mode, 'auto');
  assert.equal(modeChange({ installed: '1.13.2', latest: '', command: 'auto' }).store.mode, 'auto');
});

test('check clears the pin, so notices start again', () => {
  const r = modeChange({ installed: '1.13.2', latest: '1.14.0', command: 'check' });
  assert.deepEqual(r.store, { mode: 'check', pinned: '', notified: '' });
});

test('an unknown subcommand changes nothing and says what to use', () => {
  const r = modeChange({ command: 'maybe', installed: '1.13.2', latest: '1.13.2' });
  assert.equal(r.store, null);
  assert.equal(r.invalid, true);
  assert.match(r.text, /on · off · auto · confirm/);
});