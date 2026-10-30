// A bound topic runs under a profile of its own, and that profile is where the
// sandbox boundary lives. The tests below pin the three answers a turn can get:
// a narrow profile, no narrowing at all, and a refusal — because the fourth
// answer, "run it under the wide policy anyway", is the bug this change closes.
//
// DSH_HOME is set before the first import: `paths.mjs` reads it once, at load,
// and pointing it at the machine's real profiles is how a test once installed
// into them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TABLE = `version: 1
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
- id: sandbox-policy
  name: "@deepseek-ai/dsh-sandbox-policy"
  config:
    mode: danger-full-access
    workspaceRoot: C:/base
`;

const BARE = `version: 1
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    model: base-model
`;

const HOME = mkdtempSync(join(tmpdir(), 'ws-home-'));
for (const [name, patch] of [['headless', TABLE], ['bare', BARE]]) {
  const dir = join(HOME, 'profiles', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cordis.patch.yml'), patch, 'utf8');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `dsh-profile-${name}` }), 'utf8');
}
writeFileSync(join(HOME, 'config.json'), JSON.stringify({ profile: 'headless', lang: 'en' }), 'utf8');
writeFileSync(join(HOME, 'state.json'), JSON.stringify({ offset: 0, sessions: {} }), 'utf8');
process.env.DSH_HOME = HOME;

const { state } = await import('../core/state.mjs');
const { turnPlan, workspaceOf } = await import('../profile/profile-view.mjs');

/** A clean topic: no directory, no set, no wide flag, the default profile. */
function reset() {
  state.cwd = {};
  state.wide = {};
  state.agentsets = {};
  state.profiles = {};
}

test('a bound topic gets a profile whose workspaceRoot is that directory', () => {
  reset();
  state.cwd = { '1:2': 'C:/work/app' };
  const plan = turnPlan('1:2');
  assert.equal(plan.error, undefined);
  assert.equal(plan.workspace, 'C:/work/app');
  assert.match(plan.profile, /^aset-[0-9a-f]{10}$/);
  const patch = readFileSync(join(HOME, 'profiles', plan.profile, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /workspaceRoot: C:\/work\/app/);
  // The base profile keeps its own root: materialising is a copy, not an edit.
  assert.match(readFileSync(join(HOME, 'profiles', 'headless', 'cordis.patch.yml'), 'utf8'), /workspaceRoot: C:\/base/);
});

test('`wide` and an unbind both go back to the profile boundary', () => {
  reset();
  state.cwd = { '1:2': 'C:/work/app' };
  state.wide = { '1:2': true };
  assert.equal(workspaceOf('1:2'), '');
  assert.equal(turnPlan('1:2').profile, 'headless');
  // A directory that is no longer bound is not narrowed either.
  state.wide = {};
  state.cwd = {};
  assert.equal(turnPlan('1:2').workspace, '');
  assert.equal(turnPlan('1:2').profile, 'headless');
});

test('a profile with no permission table is never given half a policy', () => {
  reset();
  state.profiles = { '1:2': 'bare' };
  state.cwd = { '1:2': 'C:/work/app' };
  // Without a table there is no mode to derive, so the topic stays wide and
  // says so rather than booting a profile with an unstated boundary.
  assert.equal(workspaceOf('1:2'), '');
  assert.equal(turnPlan('1:2').profile, 'bare');
});

test('a set asking for a narrow policy on a bare profile is refused, not run wide', () => {
  reset();
  state.profiles = { '1:2': 'bare' };
  state.agentsets = { '1:2': 'careful' };
  writeFileSync(
    join(HOME, 'agentsets.json'),
    JSON.stringify({ rev: 1, sets: { careful: { id: 'careful', name: 'Careful', permissions: 'read-only' } } }),
    'utf8',
  );
  const plan = turnPlan('1:2');
  assert.equal(plan.profile, 'bare');
  assert.match(plan.error, /no permission table/);
  assert.match(plan.error, /read-only/);
});
