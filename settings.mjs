/**
 * Resolution of the settings that decide what a turn runs.
 *
 * Four tiers, narrowest first:
 *
 *   per-topic override (state.settings[key])  > agentset field  > profile row
 *   > install default (the profile `headless` itself points at)
 *
 * The result is a flat, plain object plus a `sources` map that says where each
 * value came from — the card and `/status` must be able to show "the set is
 * broken" and "the set was ignored" as different things.
 *
 * Pure by design: no file access, no state writes. The caller reads the profile
 * row values once and passes them in, so the same function serves the command
 * replies and the turn spawn.
 */
import { FIELDS } from './agentsets.mjs';

/** Parsed profile-row values, as the caller read them from the patch. */
export function profileValues({ model = {}, permissions = '', preset = '', effort = '', lang = '' } = {}) {
  return {
    model: model.model && model.model !== '?' ? model.model : '',
    provider: model.provider && model.provider !== '?' ? model.provider : '',
    permissions: permissions || '',
    dshPreset: preset || '',
    effort: effort || '',
    lang: lang || '',
  };
}

/**
 * @param {object} input
 * @param {object} input.set     the agentset bound to the topic, or null
 * @param {object} input.override `state.settings[key]` for this topic, or null
 * @param {object} input.profile `profileValues(...)` of the topic's profile
 * @param {string[]} input.models declared model ids of the topic's profile
 * @param {string[]} input.efforts declared effort ids for the winning model
 * @param {string[]} input.permissions declared permission preset ids
 * @param {string[]} input.presets declared dsh agent preset ids
 */
export function resolveSettings({
  set = null,
  override = null,
  profile = profileValues(),
  models = [],
  efforts = [],
  permissions = [],
  presets = [],
} = {}) {
  const src = {};
  const from = (field, ...values) => {
    for (const [tier, value] of [
      ['topic', override?.[field]],
      ['set', set?.[field]],
      ['profile', profile[field]],
    ]) {
      if (typeof value === 'string' && value.trim() !== '') {
        src[field] = tier;
        return value.trim();
      }
    }
    src[field] = 'default';
    return '';
  };

  const model = from('model');
  const provider = from('provider');
  const effort = from('effort');

  // A value the profile never declared would only fail on the next turn, so it
  // is dropped here — and the source says so, which is how the card explains
  // itself instead of silently running something else.
  const valid = (field, value, declared) => {
    if (!value) return { value, ok: true };
    if (declared.length === 0) return { value, ok: true }; // profile has no list: trust the value
    if (declared.includes(value)) return { value, ok: true };
    return { value: profile[field] || '', ok: false };
  };
  // A model the profile never declared would only fail on the next turn, so it
  // is dropped here — and the source says so, which is how the card explains
  // itself instead of silently running something else.
  const modelDropped = Boolean(model) && models.length > 0 && !models.includes(model);
  const checkedModel = { value: modelDropped ? profile.model : model };
  if (modelDropped) {
    src.model = `${src.model} (invalid)`;
    src.provider = `${src.provider} (follows model)`;
  }
  // The effort belonged to the model that was just dropped: it was never
  // declared for the model that actually runs, so it must not survive it.
  const effortList = efforts;
  const effortDropped = Boolean(effort) && effortList.length > 0 && !effortList.includes(effort);
  const checkedEffort = { value: effortDropped ? (profile.effort || '') : effort };
  if (effortDropped) src.effort = `${src.effort} (invalid)`;
  const permissionsDropped = Boolean(permissions.length) && !permissions.includes(from('permissions'));
  const checkedPermissions = { value: permissionsDropped ? profile.permissions : from('permissions') };
  if (permissionsDropped) src.permissions = `${src.permissions} (invalid)`;
  const checkedPreset = valid('dshPreset', from('dshPreset'), presets);
  if (!checkedPreset.ok) src.dshPreset = `${src.dshPreset} (invalid)`;

  const plugins = {
    add: [...(set?.plugins?.add || [])],
    remove: [...(set?.plugins?.remove || [])],
    disable: [...(set?.plugins?.disable || [])],
    enable: [...(set?.plugins?.enable || [])],
  };
  const toolFilter = {
    deny: [...(set?.toolFilter?.deny || [])],
    allow: [...(set?.toolFilter?.allow || [])],
  };
  const agents = { ...(set?.agents || {}) };

  const out = {
    model: checkedModel.value,
    provider: checkedModel.ok ? provider : profile.provider,
    effort: checkedEffort.value,
    permissions: checkedPermissions.value,
    dshPreset: checkedPreset.value,
    lang: from('lang'),
    thinkBlock: set?.thinkBlock || '',
    plugins,
    toolFilter,
    agents,
    base: set?.base || '',
    sources: src,
  };
  out.touchesProfile = touchesProfile(out);
  return out;
}

/**
 * Would this resolution have to become a profile of its own? Only values that
 * came from the topic or the set count: a value inherited from the profile is
 * already true of the profile and needs no overlay.
 */
export function touchesProfile(resolved) {
  const own = (field) => resolved.sources?.[field] === 'topic' || resolved.sources?.[field] === 'set';
  return Boolean(
    own('model')
    || own('effort')
    || own('permissions')
    || own('dshPreset')
    || Object.keys(resolved.agents || {}).length
    || resolved.toolFilter?.deny?.length
    || resolved.toolFilter?.allow?.length,
  );
}

/**
 * One line for the progress panel: only the fields that actually differ from
 * the bare profile. Empty string means "render nothing", so an install that
 * never uses sets sees a byte-identical panel.
 */
export function settingsChip(resolved, { name = '' } = {}) {
  if (!resolved || !resolved.touchesProfile) return '';
  const own = (field) => resolved.sources?.[field] === 'topic' || resolved.sources?.[field] === 'set';
  const parts = [];
  if (name) parts.push(name);
  const route = own('model') || own('effort')
    ? `${resolved.model}${resolved.effort ? `/${resolved.effort}` : ''}`
    : '';
  if (route) parts.push(route);
  if (own('permissions') && resolved.permissions) parts.push(resolved.permissions);
  return parts.join(' · ');
}

/** The field list a hand-written `/agentset edit` may touch. */
export const EDITABLE = FIELDS;
