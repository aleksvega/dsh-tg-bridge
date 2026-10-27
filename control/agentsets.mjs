// Agent sets: a named bundle of subagents a topic can be bound to, with the card and the keyboard that edit it.
//
// Split out of `control.mjs` by the 500-line plan: the command handlers that
// follow call these, and none of them needs the dispatcher to do it.
import { join } from 'node:path';
import { t } from '../i18n.mjs';
import { parseAgentPresets, parsePermissionPresets, parseReasoningEfforts } from '../agents.mjs';
import { AgentsetStore } from '../agentsets.mjs';
import { profileValues, resolveSettings } from '../settings.mjs';
import { DSH_HOME } from '../paths.mjs';

import { read, patchPath, modelsOf, modelOf } from './models.mjs';
export const fmt = (rows) => rows.map((row) => `  ${row}`).join('\n');

/**
 * Named bundles of per-topic agent settings. The file sits next to state.json
 * and keeps its own revision counter, so a write from a second process cannot
 * silently drop a set saved a moment earlier.
 */
export const AGENTSETS = join(process.env.DSH_TG_HOME || join(DSH_HOME, 'tg-bridge'), 'agentsets.json');
let agentsetStore = null;
export function agentset() {
  if (!agentsetStore) agentsetStore = new AgentsetStore(AGENTSETS).load();
  return agentsetStore;
}

/** The set bound to this topic, or null. */
export function agentsetOf(state, key) {
  const id = state.agentsets?.[key];
  return id ? agentset().get(id) : null;
}

/** What the topic's profile declares — the tier every set inherits from. */
export function profileRowOf(profile) {
  return profileValues({
    model: modelOf(profile),
    permissions: (parsePermissionPresets(read(patchPath(profile))) || {}).current || '',
    preset: (parseAgentPresets(read(patchPath(profile))) || {}).selected || '',
    effort: '',
    lang: '',
  });
}

/** Bind/unbind this topic. The set itself lives in agentsets.json. */
export function bindAgentset(state, key, id) {
  state.agentsets = state.agentsets || {};
  if (id) state.agentsets[key] = id;
  else delete state.agentsets[key];
}

/** One set rendered for a chat: what it owns, what it inherits. */
export function agentsetCard(set, lang, profile, boundId) {
  const row = profileRowOf(profile);
  const resolved = resolveSettings({
    set,
    profile: row,
    models: modelsOf(profile),
    efforts: parseReasoningEfforts(read(patchPath(profile)), set.model || row.model) || [],
    permissions: (parsePermissionPresets(read(patchPath(profile))) || {}).presets?.map((p) => p.id) || [],
    presets: (parseAgentPresets(read(patchPath(profile))) || {}).presets?.map((p) => p.id) || [],
  });
  const pick = (field) => (set[field] ? set[field] : `— ${t(lang, 'ctrl.set.inherit')}`);
  const lines = [
    t(lang, `${boundId === set.id ? 'ctrl.set.titleBound' : 'ctrl.set.title'}`, { name: set.name || set.id }),
    `${t(lang, 'ctrl.set.id')}: ${set.id}${set.builtin ? ` (${t(lang, 'ctrl.set.builtin')})` : ''}`,
    `${t(lang, 'ctrl.set.field.model')}: ${pick('model')}`,
    `${t(lang, 'ctrl.set.field.effort')}: ${pick('effort')}`,
    `${t(lang, 'ctrl.set.field.permissions')}: ${pick('permissions')}`,
    `${t(lang, 'ctrl.set.field.preset')}: ${pick('dshPreset')}`,
    `${t(lang, 'ctrl.set.field.lang')}: ${pick('lang')}`,
  ];
  const warnings = [];
  for (const field of ['model', 'effort', 'permissions', 'dshPreset']) {
    if (String(resolved.sources[field] || '').endsWith('(invalid)')) {
      warnings.push(t(lang, 'ctrl.set.dropped', { field }));
    }
  }
  if (set.notes) lines.push('', set.notes);
  if (warnings.length > 0) lines.push('', ...warnings);
  lines.push('', t(lang, 'ctrl.set.hint'));
  return lines.join('\n');
}

/**
 * The same set as real buttons. Only the fields this set actually overrides get
 * a button: a slot that does nothing is worse than no button, and the typed
 * form stays available for everything else. Button payloads are ASCII (`as:`
 * verbs), so a Chinese or Russian label never changes what a press means.
 */
export function agentsetKeyboard(set, lang, boundId) {
  const labels = {
    model: t(lang, 'ctrl.set.field.model'),
    effort: t(lang, 'ctrl.set.field.effort'),
    permissions: t(lang, 'ctrl.set.field.permissions'),
    dshPreset: t(lang, 'ctrl.set.field.preset'),
    lang: t(lang, 'ctrl.set.field.lang'),
  };
  const slots = Object.keys(labels)
    .filter((field) => set[field])
    .map((field) => `${labels[field]}|${field}`);
  const rows = cardKeyboard(
    { id: set.id },
    { bound: boundId === set.id, builtin: Boolean(set.builtin), slots },
  );
  if (boundId === set.id) {
    // The "use" button is drawn for every set; on the bound one it says so.
    for (const row of rows) {
      for (const button of row) {
        if (button.data === `as:use:${set.id}`) button.text = `✓ ${t(lang, 'ctrl.set.bound')}`;
      }
    }
  }
  return rows;
}
