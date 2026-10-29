// What a turn may touch, tested against what the host actually does with it.
//
// Measured on the host with `dsh --patch` (written up in the change's design.md):
//
//   A. sandbox row `mode: read-only` + `defaultPreset: danger-full-access`
//      → a write OUTSIDE the root SUCCEEDED. The sandbox row was ignored.
//   B. the reverse pair → the same write was denied
//      `[sandbox: file access denied under read-only mode]`.
//   C. `workspace-write` → outside denied, inside allowed.
//
// So `defaultPreset` is the row a turn runs under, and `sandbox-policy` is
// rewritten from it at boot. Two rows, one policy: a file where they disagree is
// a file that lies to whoever reads it, which is why one function writes both and
// these tests assert they agree. If a future host flips the precedence, no test
// here can notice (it would have to boot a host) — but `checkPermission` at boot
// and the design note both point at the place to look.
import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePermissionPresets } from '../agents.mjs';
import {
  checkPermission,
  effectivePreset,
  permissionEnabled,
  sandboxModeOf,
  sandboxRow,
  setPermission,
} from '../permission-rows.mjs';

const TABLE = `# A profile that restates the permission table whole, as DSH requires.
- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: never
      workspace-write:
        sandbox: workspace-write
        approval: never
      danger-full-access:
        sandbox: danger-full-access
        approval: never
    defaultPreset: danger-full-access
`;

/** What each row claims, read back the way a person would. */
function claims(patch) {
  const table = parsePermissionPresets(patch);
  const named = /defaultPreset:\s*(\S+)/.exec(patch)?.[1] || '';
  const entry = table?.presets.find((row) => row.id === named);
  return { named, presetMode: entry?.sandbox || '', rowMode: sandboxRow(patch)?.mode || '' };
}

test('one call moves the preset and the sandbox row to the same mode', () => {
  const out = setPermission(TABLE, { preset: 'read-only' });
  const got = claims(out);
  assert.equal(got.named, 'read-only');
  assert.equal(got.presetMode, 'read-only');
  // A profile with no sandbox row of its own gains one, so the two agree by
  // construction instead of by inheriting whatever the bundle ships.
  assert.equal(got.rowMode, 'read-only');
  assert.equal(out.match(/- id: sandbox-policy/g).length, 1);
});

test('a preset the table does not list is not turned into a guessed mode', () => {
  const out = setPermission(TABLE, { preset: 'no-such-preset' });
  // The name is written (refusing it is the caller's job) but no mode is invented
  // and no second row appears to contradict the first.
  assert.match(out, /defaultPreset: no-such-preset/);
  assert.doesNotMatch(out, /- id: sandbox-policy/);
  assert.equal(sandboxModeOf(TABLE, 'no-such-preset'), '');
});

test('an existing sandbox row is edited in place, comments and root untouched', () => {
  const withRow = `${TABLE}- id: sandbox-policy
  name: "@deepseek-ai/dsh-sandbox-policy"
  config:
    # home-wide writes only: a Telegram turn cannot touch C:\\Windows.
    mode: danger-full-access
    workspaceRoot: C:/Users/someone
`;
  const out = setPermission(withRow, { preset: 'workspace-write' });
  assert.equal(out.match(/- id: sandbox-policy/g).length, 1);
  assert.match(out, /^ {4}mode: workspace-write$/m);
  assert.match(out, /# home-wide writes only/);
  // The root is not the caller's to change here, so it stays where it was.
  assert.match(out, /workspaceRoot: C:\/Users\/someone/);
});

test('moving only the root keeps the mode the preset already stands for', () => {
  const withRow = `${TABLE}- id: sandbox-policy
  name: "@deepseek-ai/dsh-sandbox-policy"
  config:
    mode: danger-full-access
    workspaceRoot: C:/Users/someone
`;
  const out = setPermission(withRow, { workspaceRoot: 'C:/work/other' });
  assert.match(out, /workspaceRoot: C:\/work\/other/);
  assert.match(out, /^ {4}mode: danger-full-access$/m);
  assert.match(out, /defaultPreset: danger-full-access/);
});

test('the effective preset is defaultPreset, falling back to the sandbox row', () => {
  assert.equal(effectivePreset(TABLE).id, 'danger-full-access');
  assert.equal(effectivePreset(TABLE).from, 'defaultPreset');
  // A profile that names a mode and no preset: the host resolves it by mode.
  const byMode = `${TABLE.replace(/ {4}defaultPreset: .*\n/, '')}- id: sandbox-policy
  name: "@deepseek-ai/dsh-sandbox-policy"
  config:
    mode: workspace-write
    workspaceRoot: C:/work
`;
  assert.equal(effectivePreset(byMode).id, 'workspace-write');
  assert.equal(effectivePreset(byMode).from, 'sandbox-row');
  // A name the table does not list is reported as unknown, never as a preset.
  const broken = TABLE.replace('defaultPreset: danger-full-access', 'defaultPreset: gone');
  assert.equal(effectivePreset(broken).from, 'unknown');
  assert.equal(effectivePreset('# nothing here'), null);
});

test('a profile only opts in when it states both rows', () => {
  assert.equal(permissionEnabled(TABLE), false, 'a table without a sandbox row cannot be narrowed');
  assert.equal(permissionEnabled(`${TABLE}- id: sandbox-policy
  name: "@deepseek-ai/dsh-sandbox-policy"
  config:
    mode: danger-full-access
`), true);
  assert.equal(permissionEnabled('- id: sandbox-policy\n  name: "@deepseek-ai/dsh-sandbox-policy"\n  config:\n    mode: read-only\n'), false);
});

test('boot refuses an unusable preset instead of dying on the first tool call', () => {
  assert.deepEqual(checkPermission(TABLE), { ok: true });
  const unknown = checkPermission(TABLE.replace('defaultPreset: danger-full-access', 'defaultPreset: gone'));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'unknown-preset');
  assert.match(unknown.detail, /gone/);
  // Two rows that disagree is the state the host silently resolves in favour of
  // the preset — the turn runs, so this is a warning, not a refusal.
  const disagree = checkPermission(`${TABLE}- id: sandbox-policy
  name: "@deepseek-ai/dsh-sandbox-policy"
  config:
    mode: read-only
`);
  assert.equal(disagree.ok, true);
  assert.match(disagree.warn, /danger-full-access.*read-only/);
  // A profile with no permission table at all is not this bridge's business.
  assert.deepEqual(checkPermission('- id: x\n  name: y\n'), { ok: true });
});
