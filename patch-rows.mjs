// The patch knobs a settings bundle writes, expressed as text -> text.
//
// Built on `profile-edit.mjs` instead of a YAML writer on purpose: the patch is
// the person's config — comments, ordering and quoting stay where they are, and
// a new value lands on the existing line. Each function returns the new patch,
// or the input unchanged when the profile has no such row.
//
// Permissions live in `permission-rows.mjs`: they are two rows that must agree,
// and a writer that can move only one of them is the bug that file prevents.
import { setRowConfig } from './profile-edit.mjs';

/** The row that decides which model a turn runs on. */
export const MODEL = '@deepseek-ai/dsh-agent-default-model';
/** The registry whose `selectedDefault` starts the agent preset. */
export const PRESETS = '@deepseek-ai/dsh-agent-preset-registry';
const SUBAGENT = '@deepseek-ai/dsh-tool-subagent';

/** Point the turn's model row at `model`, keeping the provider when no new one is given. */
export function setModel(patch, model, provider = '') {
  let next = setRowConfig(patch, { pkg: MODEL, path: ['model'], value: model }) ?? String(patch ?? '');
  if (provider) next = setRowConfig(next, { pkg: MODEL, path: ['provider'], value: provider }) ?? next;
  return next;
}

/** Start the agent-preset registry in `preset`. */
export function setAgentPreset(patch, preset) {
  return setRowConfig(patch, { pkg: PRESETS, path: ['selectedDefault'], value: preset }) ?? String(patch ?? '');
}

/**
 * One delegation row per tool: `{ subagent: { model, depth } }`. A key that is
 * absent means "leave what the base says".
 */
export function setSubagents(patch, agents) {
  let next = String(patch ?? '');
  for (const [tool, config] of Object.entries(agents || {})) {
    if (tool !== 'subagent' && tool !== 'subagent_fork') continue;
    if (!config || typeof config !== 'object') continue;
    const match = (row) => new RegExp(`toolName:\\s*['"]?${tool}['"]?`).test(row.text);
    if (config.model) next = setRowConfig(next, { pkg: SUBAGENT, path: ['agentOptions', 'model'], value: config.model, match }) ?? next;
    if (config.depth !== undefined && config.depth !== '') {
      next = setRowConfig(next, { pkg: SUBAGENT, path: ['maxDepth'], value: config.depth, match }) ?? next;
    }
  }
  return next;
}
