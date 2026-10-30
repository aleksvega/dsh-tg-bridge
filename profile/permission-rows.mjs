// The two rows that decide what a turn may touch, read and written in one place.
//
// A profile describes its permission policy twice: `permission-presets` names a
// table of presets and the `defaultPreset` to start in, and `sandbox-policy`
// names a `mode` and the `workspaceRoot` writes may reach. Measured on the host
// (the three experiments are in the change's `design.md`):
//
//   A. sandbox row `read-only` + `defaultPreset: danger-full-access`
//      → a write OUTSIDE the root SUCCEEDED: the sandbox row was ignored.
//   B. the reverse pair → denied, `[sandbox: file access denied under read-only
//      mode]`.
//   C. `workspace-write` → outside denied, inside allowed.
//
// So the preset wins and the sandbox row is rewritten from it at boot. Two rows,
// one policy: a file where they disagree lies to whoever reads it, and the next
// person to debug a denial reads whichever row they hit first. Every write goes
// through `setPermission` here, and `checkPermission` is what boot and every turn
// run instead of learning the mismatch from a failed tool call.
import { parsePermissionPresets } from './agents.mjs';
import { appendRow, rowExists, setRowConfig } from './profile-edit.mjs';

/** The row whose `defaultPreset` picks an entry of the permission table. */
export const PERMISSIONS = '@deepseek-ai/dsh-permission-presets';
/** The row that states the mode and the directory a turn's writes may reach. */
export const SANDBOX = '@deepseek-ai/dsh-sandbox-policy';

/**
 * What the `sandbox-policy` row says, or null when the profile has none. Read
 * from the row's own block, so a comment that mentions a mode is not a mode.
 * @param {string} patch profile patch
 * @returns {{mode: string, workspaceRoot: string} | null}
 */
export function sandboxRow(patch) {
  const lines = String(patch ?? '').split(/\r?\n/);
  const at = lines.findIndex((line) => /^\s*name:\s*['"]?@deepseek-ai\/dsh-sandbox-policy['"]?\s*$/.test(line));
  if (at < 0) return null;
  const out = { mode: '', workspaceRoot: '' };
  for (let i = at + 1; i < lines.length; i += 1) {
    const line = lines[i];
    // The next row starts at the left margin and ends this one.
    if (/^- /.test(line)) break;
    const pair = /^\s{4,}([A-Za-z]+):\s*(\S+)\s*$/.exec(line);
    if (!pair || (pair[1] !== 'mode' && pair[1] !== 'workspaceRoot') || out[pair[1]]) continue;
    out[pair[1]] = pair[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/**
 * The preset a turn will actually run under: `defaultPreset` when the table
 * names it, otherwise the entry whose sandbox matches the sandbox row — which is
 * how the host itself resolves a profile that states a mode and no preset.
 * @returns {{id: string, sandbox: string, approval: string, from: string} | null}
 *   `from` is `defaultPreset`, `sandbox-row` or `unknown` (a name the table does
 *   not list: reported, never guessed into a mode).
 */
export function effectivePreset(patch) {
  const table = parsePermissionPresets(patch);
  const row = sandboxRow(patch);
  const presets = table?.presets || [];
  const named = table?.current || '';
  if (named) {
    const entry = presets.find((preset) => preset.id === named);
    return entry ? { ...entry, from: 'defaultPreset' } : { id: named, sandbox: '', approval: '', from: 'unknown' };
  }
  const mode = row?.mode || '';
  if (!mode) return null;
  const entry = presets.find((preset) => preset.sandbox === mode);
  return entry ? { ...entry, from: 'sandbox-row' } : { id: mode, sandbox: mode, approval: '', from: 'sandbox-row' };
}

/** The mode a preset id stands for, or '' when the table has no such preset. */
export function sandboxModeOf(patch, preset) {
  const table = parsePermissionPresets(patch);
  if (!table || !preset) return '';
  const row = table.presets.find((entry) => entry.id === preset);
  return (row && row.sandbox) || '';
}

/**
 * May the bridge narrow this profile per topic?
 *
 * Only a profile that states a table *and* a sandbox row can be narrowed safely:
 * without a table there is no preset to choose, and without a sandbox row there
 * is no boundary to move. Anything else keeps the profile-wide behaviour —
 * writing half a policy into a profile that never opted in is how a topic
 * silently loses the ability to run.
 */
export function permissionEnabled(patch) {
  const table = parsePermissionPresets(patch);
  if (!table || table.presets.length === 0) return false;
  return sandboxRow(patch) !== null;
}

/**
 * Write the policy once: the preset that is chosen and the sandbox mode it
 * stands for. Both rows or neither — a patch that moves one is a patch that
 * describes a policy it does not run.
 *
 * @param {string} patch profile patch
 * @param {object} want
 * @param {string} [want.preset] table entry to start in ('' = leave it alone)
 * @param {string} [want.sandbox] mode that entry stands for ('' = look it up)
 * @param {string} [want.workspaceRoot] directory writes may reach ('' = leave)
 */
export function setPermission(patch, { preset = '', sandbox = '', workspaceRoot = '' } = {}) {
  let next = String(patch ?? '');
  if (preset) {
    next = setRowConfig(next, { pkg: PERMISSIONS, path: ['defaultPreset'], value: preset }) ?? next;
  }
  const mode = sandbox || sandboxModeOf(next, preset);
  if (!mode && !workspaceRoot) return next;
  const config = {};
  if (mode) config.mode = mode;
  if (workspaceRoot) config.workspaceRoot = workspaceRoot;
  // A profile with no sandbox row of its own inherits the bundle's, which leaves
  // the derived profile carrying a boundary nobody wrote. State it here.
  if (!rowExists(next, SANDBOX)) {
    return appendRow(next, { id: 'sandbox-policy', pkg: SANDBOX, config }) ?? next;
  }
  for (const [key, value] of Object.entries(config)) {
    next = setRowConfig(next, { pkg: SANDBOX, path: [key], value }) ?? next;
  }
  return next;
}

/**
 * Is this profile's policy one a turn can start under?
 *
 * Only one state is fatal: a `defaultPreset` the table does not list. The host
 * fails that at startup with `match no preset` and every turn dies in seconds,
 * so it is caught here and reported as one line. Two rows that disagree is not
 * fatal — the preset wins, so the turn runs — but it is a file that lies, and it
 * comes back as `warn` for boot to log.
 * @returns {{ok: true, warn?: string} | {ok: false, code: string, detail: string}}
 */
export function checkPermission(patch) {
  const table = parsePermissionPresets(patch);
  if (!table) return { ok: true };
  const named = table.current || '';
  const ids = table.presets.map((preset) => preset.id);
  if (named && !ids.includes(named)) {
    return {
      ok: false,
      code: 'unknown-preset',
      detail: `defaultPreset "${named}" is not in the profile's preset table (${ids.join(', ') || 'empty'})`,
    };
  }
  const row = sandboxRow(patch);
  const mode = named ? sandboxModeOf(patch, named) : row?.mode || '';
  if (row && mode && row.mode && mode !== row.mode) {
    return { ok: true, warn: `defaultPreset "${named}" means ${mode} but the sandbox row says ${row.mode}` };
  }
  return { ok: true };
}
