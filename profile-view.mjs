// What a topic's turn runs under: the profile, the bound agent set, the chip.
//
// A bound set becomes a profile of its own (`aset-profile.mjs`) because DSH has
// no per-topic override; these helpers are the only place that knows how a
// topic, its set and its profile row combine.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentsetStore } from './agentsets.mjs';
import { parseAgentPresets, parsePermissionPresets, parseReasoningEfforts } from './agents.mjs';
import { modelOf, modelsOf } from './control.mjs';
import { materialiseProfile, pruneDerived } from './aset-profile.mjs';
import { profileValues, resolveSettings, settingsChip } from './settings.mjs';
import { sessionKey } from './keys.mjs';
import { DIR, DSH_HOME } from './paths.mjs';
import { log, state } from './state.mjs';
import { profileOf } from './turn.mjs';
export function settingsChipOf(key) {
  try {
    const id = state.agentsets?.[key];
    if (!id) return '';
    const store = new AgentsetStore(join(DIR, 'agentsets.json')).load();
    const set = store.get(id);
    if (!set) return '';
    const profile = profileOf(key);
    const patch = readFileSync(join(DSH_HOME, 'profiles', profile, 'cordis.patch.yml'), 'utf8');
    const resolved = resolveSettings({
      set,
      override: state.settings?.[key] || null,
      profile: profileValues(profileRowOf(profile, patch)),
      models: modelsOf(profile),
      efforts: parseReasoningEfforts(patch, set.model || modelOf(profile).model) || [],
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
 * The profile a turn actually runs under. A bound set becomes a profile of its
 * own (`aset-profile.mjs`), because DSH has no per-topic override; without a set
 * the answer is the topic's or the install's profile, unchanged.
 * `keep` tells the sweep every profile still in use.
 */
export function turnProfileOf(key) {
  const base = profileOf(key);
  try {
    const id = state.agentsets?.[key];
    if (!id) return base;
    const store = new AgentsetStore(join(DIR, 'agentsets.json')).load();
    const set = store.get(id);
    if (!set) return base;
    const derived = materialiseProfile(set, base);
    if (!derived) return base;
    const keep = Object.keys(state.agentsets || {})
      .map((topic) => {
        const bound = state.agentsets[topic];
        const other = store.get(bound);
        return other ? materialiseProfile(other, profileOf(topic)) : '';
      })
      .filter(Boolean);
    pruneDerived(keep);
    return derived;
  } catch (error) {
    // A broken store must not cost the turn: the profile runs as it would have.
    log(`aset profile failed for ${key}: ${error.message}`);
    return base;
  }
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
