// The materialised profile is what a turn actually boots, so these tests run it
// against a fake base profile: a wrong row id boots a host with no model
// override — silently, and only on the topic that asked for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_PATCH = `version: 1
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: example-provider
    model: base-model
- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: never
      danger-full-access:
        sandbox: danger-full-access
        approval: never
    defaultPreset: danger-full-access
- id: agent-preset
  name: "@deepseek-ai/dsh-agent-preset-registry"
  config:
    selectedDefault: standard
`;

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), 'aset-'));
  const dir = join(home, 'profiles', 'headless');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cordis.patch.yml'), BASE_PATCH, 'utf8');
  writeFileSync(join(dir, 'package.json'), '{"name":"dsh-profile-headless"}', 'utf8');
  writeFileSync(join(dir, 'main.bak-20260101'), 'old', 'utf8');
  return home;
}

test('a set that changes nothing produces no profile at all', async () => {
  const { materialiseProfile } = await import('../aset-profile.mjs');
  const home = fakeHome();
  const profiles = join(home, 'profiles');
  assert.equal(materialiseProfile({ id: 'same', model: 'base-model' }, 'headless', { profiles }), '');
  assert.equal(materialiseProfile({ id: 'empty' }, 'headless', { profiles }), '');
  assert.equal(materialiseProfile({ id: 'x', model: 'm' }, 'missing', { profiles }), '');
});

test('a model set rewrites the row DSH reads, and nothing else changes', async () => {
  const { materialiseProfile } = await import('../aset-profile.mjs');
  const home = fakeHome();
  const profiles = join(home, 'profiles');
  const name = materialiseProfile({ id: 'reviewer', name: 'Reviewer', model: 'big-model' }, 'headless', { profiles });
  assert.match(name, /^aset-[0-9a-f]{10}$/);
  const patch = readFileSync(join(profiles, name, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /- id: agent-default-model[\s\S]*?model: big-model/);
  assert.match(patch, /provider: example-provider/, 'the provider stays with the base');
  assert.doesNotMatch(patch, /model: base-model/);
  assert.match(patch, /defaultPreset: danger-full-access/, 'untouched rows survive verbatim');
  // The same set twice is the same directory; a different set is not.
  assert.equal(materialiseProfile({ id: 'reviewer', name: 'Reviewer', model: 'big-model' }, 'headless', { profiles }), name);
  const other = materialiseProfile({ id: 'fast', model: 'small-model' }, 'headless', { profiles });
  assert.notEqual(other, name);
  // Copies never carry the base's backups.
  assert.equal(existsSync(join(profiles, name, 'main.bak-20260101')), false);
  assert.ok(existsSync(join(profiles, name, 'package.json')));
});

test('permissions and the agent preset land on their own rows', async () => {
  const { materialiseProfile } = await import('../aset-profile.mjs');
  const home = fakeHome();
  const profiles = join(home, 'profiles');
  const name = materialiseProfile(
    { id: 'careful', model: 'base-model', permissions: 'read-only', dshPreset: 'reviewer' },
    'headless',
    { profiles },
  );
  const patch = readFileSync(join(profiles, name, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /defaultPreset: read-only/);
  assert.match(patch, /selectedDefault: reviewer/);
  assert.doesNotMatch(patch, /defaultPreset: danger-full-access/);
});

test('a preset the base starts with is not a delta on its own', async () => {
  const { materialiseProfile } = await import('../aset-profile.mjs');
  const home = fakeHome();
  const profiles = join(home, 'profiles');
  assert.equal(materialiseProfile({ id: 'x', dshPreset: 'standard' }, 'headless', { profiles }), '');
});

test('a sweep removes stale generated profiles and keeps the ones in use', async () => {
  const { materialiseProfile, pruneDerived } = await import('../aset-profile.mjs');
  const home = fakeHome();
  const profiles = join(home, 'profiles');
  const keep = materialiseProfile({ id: 'a', model: 'one' }, 'headless', { profiles });
  const stale = materialiseProfile({ id: 'b', model: 'two' }, 'headless', { profiles });
  assert.deepEqual(pruneDerived([keep], { profiles }), [stale]);
  assert.ok(existsSync(join(profiles, keep)));
  assert.equal(existsSync(join(profiles, stale)), false);
  // A hand-made profile is never touched, however old it is.
  assert.ok(existsSync(join(profiles, 'headless')));
  assert.equal(pruneDerived([], { profiles: join(home, 'nope') }).length, 0);
});