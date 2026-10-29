// Materialised settings bundles.
//
// A set is a delta over a profile: '' in a field means "whatever the profile
// says". DSH itself has no per-topic override — a turn runs under one profile
// and that profile owns the model, the permission table and the agent-preset
// registry. So the only way to give one topic its own model without touching
// the profile of every other topic is to hand that topic a profile of its own:
// a copy of the base with the set's values written into the same rows, exactly
// like `profiles.mjs` does for the vision overlay. This module builds and
// prunes those copies.
//
// The generated profile is derived data. Its name carries a hash of the input,
// so a changed set lands in a different directory and a stale copy is simply
// never selected again; `pruneDerived` keeps only the ones in use.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setAgentPreset, setModel, setSubagents } from './patch-rows.mjs';
import { sandboxModeOf, setPermission } from './permission-rows.mjs';

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const PROFILES = join(DSH_HOME, 'profiles');

/** Every generated profile starts with this, so a GC cannot eat a hand-made one. */
export const DERIVED_PREFIX = 'aset-';

/** `aset-` + 10 hex: short enough for a DSH profile name, long enough to collide never. */
export function derivedName(base, set, workspace = '') {
  const material = JSON.stringify([
    base,
    set?.name || '',
    set?.model || '',
    set?.effort || '',
    set?.permissions || '',
    set?.dshPreset || '',
    // The bound directory belongs in the name: a topic moved with `/cd` must not
    // keep a profile whose workspaceRoot points at the project it left. It is a
    // separate argument, not a set field, because a set is shared between topics
    // and the workspace is not.
    String(workspace || ''),
    set?.agents || null,
    set?.toolFilter || null,
  ]);
  return `${DERIVED_PREFIX}${createHash('sha256').update(material).digest('hex').slice(0, 10)}`;
}

/**
 * The base patch with the set's own values written into the rows DSH reads.
 * A field that already matches the base is skipped, so the copy differs from
 * the base only where the set differs — otherwise every generated profile
 * would pin today's model forever.
 *
 * The workspace is the exception: a bound topic states its own boundary even
 * when the base happens to name the same directory, because inheriting one is
 * how a later edit to the base quietly widens a topic that never asked.
 */
export function overlayPatch(basePatch, set, base = {}, workspace = '') {
  const source = String(basePatch ?? '');
  let next = source;
  const model = String(set?.model || '').trim();
  if (model && model !== base.model) next = setModel(next, model, String(set?.provider || '').trim());
  const permissions = String(set?.permissions || '').trim();
  const bound = String(workspace || '').trim();
  // Both permission rows are written together (see `permission-rows.mjs`): the
  // preset that is chosen and the sandbox mode it stands for. A profile that
  // moves one and not the other describes a policy it does not run.
  const presetId = (permissions && permissions !== base.permissions) ? permissions : '';
  if (presetId || bound) {
    const wanted = presetId || base.permissions || '';
    next = setPermission(next, {
      preset: wanted,
      sandbox: sandboxModeOf(next, wanted),
      workspaceRoot: bound,
    });
  }
  const preset = String(set?.dshPreset || '').trim();
  if (preset && preset !== base.preset) next = setAgentPreset(next, preset);
  if (set?.agents && typeof set.agents === 'object') next = setSubagents(next, set.agents);
  return { patch: next, changed: next !== source };
}

/**
 * Build `<base>`'s copy for `set` and return the profile name to run under.
 * Returns '' when there is nothing to materialise (the set changes nothing a
 * profile owns) or when the base profile is missing.
 *
 * `workspace` is the topic's bound directory, if any: it becomes this profile's
 * `workspaceRoot`, which is what makes the host sandbox — not a prompt — the
 * thing that stops a turn at the project's edge.
 */
export function materialiseProfile(set, base, { profiles = PROFILES, workspace = '' } = {}) {
  // A topic may be bound to a directory without being bound to a set: `/cd` is
  // the common case and it still needs a profile of its own, or the boundary is
  // whatever the base says.
  if (!base || (!set && !workspace)) return '';
  const baseDir = join(profiles, base);
  const basePatchPath = join(baseDir, 'cordis.patch.yml');
  if (!existsSync(basePatchPath)) return '';
  const basePatch = readFileSync(basePatchPath, 'utf8');
  const { patch, changed } = overlayPatch(basePatch, set, baseRowOf(basePatch), workspace);
  if (!changed) return '';
  const name = derivedName(base, set, workspace);
  const dir = join(profiles, name);
  if (existsSync(join(dir, 'cordis.patch.yml'))) return name;
  mkdirSync(dir, { recursive: true });
  // Everything the base has except its module tree: the plugins are the same,
  // and copying node_modules would duplicate hundreds of megabytes per set.
  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    const from = join(baseDir, entry.name);
    if (entry.isFile() && !entry.name.endsWith('.bak') && !entry.name.includes('.bak-')) {
      copyFileSync(from, join(dir, entry.name));
    }
  }
  writeFileSync(join(dir, 'cordis.patch.yml'), patch, 'utf8');
  // A junction keeps the same plugin install instead of booting a bare host.
  const modules = join(dir, 'node_modules');
  if (!existsSync(modules)) {
    try {
      symlinkSync(join(baseDir, 'node_modules'), modules, 'junction');
    } catch {
      // Without the link the profile still boots, just without the plugins.
    }
  }
  return name;
}

/** What the base patch already says, for the "is this a real delta" comparison. */
export function baseRowOf(patch) {
  const text = String(patch ?? '');
  const row = (id) => {
    const at = text.indexOf(`- id: ${id}`);
    if (at < 0) return '';
    const end = text.indexOf('\n- ', at + 5);
    return end < 0 ? text.slice(at) : text.slice(at, end);
  };
  const modelBlock = row('agent-default-model');
  const permissionBlock = row('permission');
  const presetBlock = row('agent-preset');
  const pick = (block, key) => (new RegExp(`^\\s+${key}:\\s*(\\S+)`, 'm').exec(block) || [])[1] || '';
  return {
    model: pick(modelBlock, 'model'),
    provider: pick(modelBlock, 'provider'),
    permissions: pick(permissionBlock, 'defaultPreset'),
    preset: pick(presetBlock, 'selectedDefault'),
  };
}

/**
 * Delete generated profiles nobody is bound to. `keep` is the set of names the
 * caller still points at, so a profile is removed only when it is derived,
 * stale, and unbound. Returns the names it removed.
 */
export function pruneDerived(keep = [], { profiles = PROFILES } = {}) {
  const wanted = new Set(keep.filter(Boolean));
  const removed = [];
  let entries = [];
  try {
    entries = readdirSync(profiles, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(DERIVED_PREFIX) || wanted.has(entry.name)) continue;
    try {
      rmSync(join(profiles, entry.name), { recursive: true, force: true });
      removed.push(entry.name);
    } catch {
      // A profile in use by a running turn stays until the next sweep.
    }
  }
  return removed;
}