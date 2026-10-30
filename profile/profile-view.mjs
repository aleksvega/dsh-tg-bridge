// What a topic's turn runs under: the profile, the bound agent set, the chip.
//
// A bound set becomes a profile of its own (`aset-profile.mjs`) because DSH has
// no per-topic override; these helpers are the only place that knows how a
// topic, its set and its profile row combine.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentsetStore } from './agentsets.mjs';
import { parseAgentPresets, parsePermissionPresets, parseReasoningEfforts } from './agents.mjs';
import { modelOf, modelsOf } from '../control/models.mjs';
import { materialiseProfile, pruneDerived } from './aset-profile.mjs';
import { profileValues, resolveSettings, settingsChip } from './settings.mjs';
import { sessionKey } from '../core/keys.mjs';
import { DIR, DSH_HOME } from '../core/paths.mjs';
import { log, state } from '../core/state.mjs';
import { profileOf } from '../turn/turn.mjs';
import { effectivePreset, permissionEnabled } from './permission-rows.mjs';

/** The patch text of one profile, read on demand; '' when it cannot be read. */
function patchOf(profile) {
  try {
    return readFileSync(join(DSH_HOME, 'profiles', profile, 'cordis.patch.yml'), 'utf8');
  } catch {
    return '';
  }
}

/**
 * The chip above a turn's progress: what the topic's OWN profile says.
 *
 * `profile` is the one `turnPlan` chose — a derived profile has its own
 * `defaultPreset`, so reading the base profile here would show the install's
 * preset on a topic that runs in a different one.
 */
export function settingsChipOf(key, profile = '') {
  try {
    const id = state.agentsets?.[key];
    if (!id) return '';
    const store = new AgentsetStore(join(DIR, 'agentsets.json')).load();
    const set = store.get(id);
    if (!set) return '';
    const running = profile || turnProfileOf(key);
    const patch = patchOf(running);
    const resolved = resolveSettings({
      set,
      override: state.settings?.[key] || null,
      profile: profileValues(profileRowOf(running, patch)),
      models: modelsOf(running),
      efforts: parseReasoningEfforts(patch, set.model || modelOf(running).model) || [],
      permissions: parsePermissionPresets(patch)?.presets?.map((p) => p.id) || [],
      presets: parseAgentPresets(patch)?.presets?.map((p) => p.id) || [],
    });
    return settingsChip(resolved, { name: set.name || set.id });
  } catch {
    return '';
  }
}

/** What the profile itself says, as `resolveSettings` wants it. */
export function profileRowOf(profile, patch = '') {
  const text = patch || readFileSync(join(DSH_HOME, 'profiles', profile, 'cordis.patch.yml'), 'utf8');
  const model = modelOf(profile);
  const named = parsePermissionPresets(text);
  return profileValues({
    model,
    // The preset the table actually starts in, not just the first row: a
    // profile whose default is read-only must not read as workspace-write.
    permissions: /defaultPreset:\s*(\S+)/.exec(text)?.[1] || named?.presets?.find((p) => p.sandbox)?.id || '',
    preset: parseAgentPresets(text)?.selected || '',
    effort: '',
  });
}

/**
 * The directory a topic's writes are confined to, or '' when this topic is not
 * narrowed.
 *
 * Three ways to end up empty, and all three are deliberate: no `/cd` (nothing to
 * narrow to), `/cd ... wide` (the person asked for the profile's own boundary),
 * or a profile that cannot express a boundary at all — no permission table, no
 * sandbox row — where writing half a policy would be worse than writing none.
 * @param {string} key session key
 * @param {string} [base] the profile the topic runs under
 */
export function workspaceOf(key, base = profileOf(key)) {
  const dir = String(state.cwd?.[key] || '');
  if (!dir || state.wide?.[key]) return '';
  return permissionEnabled(patchOf(base)) ? dir : '';
}

/**
 * Everything a turn needs to know about its profile, including the one case that
 * must stop it: a set that asks for a narrower policy and a base profile that
 * cannot express one. Answering with the base profile there would run the turn
 * under the wrong policy silently — the exact bug this change closes — so the
 * caller gets `error` and answers one line instead of spawning.
 *
 * @returns {{profile: string, workspace: string, error?: string}}
 */
export function turnPlan(key) {
  const base = profileOf(key);
  const workspace = workspaceOf(key, base);
  const id = state.agentsets?.[key];
  let store = null;
  try {
    store = new AgentsetStore(join(DIR, 'agentsets.json')).load();
  } catch {
    store = null;
  }
  const set = id && store ? store.get(id) : null;
  if (id && !set) return { profile: base, workspace, error: `no set ${id}` };
  const narrows = Boolean(String(set?.permissions || '').trim());
  if (narrows && !permissionEnabled(patchOf(base))) {
    return {
      profile: base,
      workspace: '',
      error: `profile ${base} has no permission table and sandbox row, so the set's preset "${set.permissions}" cannot be applied to this topic`,
    };
  }
  // A topic with no set but a bound directory still needs a profile of its own:
  // the base one carries the install's boundary, not this topic's.
  const material = set || (workspace ? { id: 'workspace' } : null);
  if (!material) return { profile: base, workspace };
  try {
    const derived = materialiseProfile(material, base, { workspace });
    if (!derived) return { profile: base, workspace };
    pruneDerived(keepList(store, base));
    return { profile: derived, workspace };
  } catch (error) {
    // A broken store must not cost the turn: the profile runs as it would have.
    log(`aset profile failed for ${key}: ${error.message}`);
    return { profile: base, workspace };
  }
}

/**
 * Every derived profile still in use, so the sweep does not delete one out from
 * under a topic that is about to run. Both bindings count: an agent set and a
 * `/cd` directory each materialise a profile.
 */
function keepList(store, base) {
  const topics = new Set([...Object.keys(state.agentsets || {}), ...Object.keys(state.cwd || {})]);
  const keep = [];
  for (const topic of topics) {
    const other = profileOf(topic);
    const set = store?.get(state.agentsets?.[topic]) || null;
    const workspace = workspaceOf(topic, other);
    const material = set || (workspace ? { id: 'workspace' } : null);
    if (!material) continue;
    const name = materialiseProfile(material, other, { workspace });
    if (name) keep.push(name);
  }
  return keep;
}

/** The profile name alone, for the callers that cannot act on an error. */
export function turnProfileOf(key) {
  return turnPlan(key).profile || profileOf(key);
}

/**
 * The permission preset this topic actually starts in, read from the profile
 * the topic runs under — the derived one when it has one, because that is the
 * file the host boots. A card that read the base profile would show the
 * install's preset on a topic that runs in a different one.
 */
export function presetOf(key) {
  const profile = turnProfileOf(key);
  return { profile, preset: effectivePreset(patchOf(profile)) };
}

/**
 * Bind, unbind or edit a set for one topic — the single implementation behind
 * `/agentset`, the card's buttons and the job a running turn drops.
 */
export function applyAsetJob(job) {
  const { chatId, threadId = 0, action = 'use', id = '', field = '', value } = job || {};
  if (!chatId) return { ok: false, text: 'no chat' };
  const key = sessionKey(String(chatId), Number(threadId) || 0);
  const store = new AgentsetStore(join(DIR, 'agentsets.json')).load();
  if (!state.agentsets) state.agentsets = {};
  if (action === 'off') {
    if (!state.agentsets[key]) return { ok: true, changed: false, text: 'no set bound' };
    delete state.agentsets[key];
    if (state.settings) delete state.settings[key];
    return { ok: true, changed: true, text: 'set off' };
  }
  const set = store.get(id);
  if (!set) return { ok: false, text: `no set ${id}` };
  if (action === 'use') {
    state.agentsets[key] = id;
    return { ok: true, changed: true, text: `bound ${id}`, setId: id };
  }
  if (action === 'edit') return { ok: false, text: 'edit goes through /agentset' };
  return { ok: false, text: `unknown action ${action}` };
}
