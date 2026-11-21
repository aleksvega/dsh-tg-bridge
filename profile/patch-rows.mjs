// The patch knobs a settings bundle writes, expressed as text -> text.
//
// Built on `profile-edit.mjs` instead of a YAML writer on purpose: the patch is
// the person's config — comments, ordering and quoting stay where they are, and
// a new value lands on the existing line. Each function returns the new patch,
// or the input unchanged when the profile has no such row.
//
// Permissions live in `permission-rows.mjs`: they are two rows that must agree,
// and a writer that can move only one of them is the bug that file prevents.
import { appendRow, rowExists, setRowConfig } from './profile-edit.mjs';

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

/** The row that loads the workspace instruction chain (AGENTS.md and friends). */
export const INSTRUCTIONS = '@deepseek-ai/dsh-agent-instructions';
/** The row that says which skill directories the catalog scans. */
export const SKILLS = '@deepseek-ai/dsh-skill-filesystem';
// The ids the base bundle declares. A profile that never mentions the row still
// gets one from `dsh-base`; appending the same id here is what makes the copy
// override it instead of adding a second, contradicting row.
const INSTRUCTION_ROW = 'agent-instructions';
const SKILL_ROW = 'skill-filesystem';
// `dsh-base` ships this budget and the plugin requires one, so a row written
// without it would lose the number the install already runs with.
const INSTRUCTION_MAX_BYTES = 65536;
// Every profile loads these; a topic's own file is an addition, never a swap.
const BASE_CANDIDATES = ['AGENTS.md', 'CLAUDE.md'];

const escapeRe = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The line range of the row that declares `pkg`, or null. */
function rowRange(lines, pkg) {
  const name = new RegExp(`^\\s*name:\\s*['"]?${escapeRe(pkg)}['"]?\\s*$`);
  const start = lines.findIndex((line) => name.test(line));
  if (start < 0) return null;
  let end = start + 1;
  for (; end < lines.length; end += 1) {
    if (/^\s*-\s*(id|name):/.test(lines[end])) break;
  }
  return { start, end };
}

/** The list a row's config already holds under `key`, so an edit adds to it. */
function listInRow(text, pkg, key) {
  const lines = String(text ?? '').split(/\r?\n/);
  const range = rowRange(lines, pkg);
  if (!range) return [];
  const keyLine = new RegExp(`^\\s*${escapeRe(key)}:\\s*$`);
  let at = -1;
  for (let i = range.start + 1; i < range.end; i += 1) {
    if (keyLine.test(lines[i])) { at = i; break; }
  }
  if (at < 0) return [];
  const pad = /^\s*/.exec(lines[at])[0].length;
  const out = [];
  for (let i = at + 1; i < range.end; i += 1) {
    if (!lines[i].trim()) continue;
    if (/^\s*/.exec(lines[i])[0].length <= pad) break;
    const item = /^\s*-\s*(.+?)\s*$/.exec(lines[i]);
    if (item) out.push(item[1].replace(/^['"]|['"]$/g, ''));
  }
  return out;
}

const cleanList = (value) => (Array.isArray(value) ? value : [value])
  .map((item) => String(item ?? '').trim())
  .filter(Boolean);

const unique = (items) => [...new Set(items)];

/**
 * Make the instruction chain also load this topic's own files.
 *
 * The candidate names are per-directory, and the plugin loads every existing
 * candidate from the project root down to the turn's directory — so the topic's
 * file lands after the project's `AGENTS.md` and after the global ones, which is
 * exactly the precedence that makes a per-topic rule specific instead of
 * authoritative. Nothing is removed from the chain: two topics in one project
 * still share `AGENTS.md`, and each only sees the file its own profile names.
 */
export function setInstructionFiles(patch, names) {
  const extra = cleanList(names);
  if (extra.length === 0) return String(patch ?? '');
  let next = String(patch ?? '');
  if (!rowExists(next, INSTRUCTIONS)) {
    next = appendRow(next, { id: INSTRUCTION_ROW, pkg: INSTRUCTIONS, config: { maxBytes: INSTRUCTION_MAX_BYTES } }) ?? next;
  }
  const wanted = unique([...BASE_CANDIDATES, ...listInRow(next, INSTRUCTIONS, 'instructionFileCandidates'), ...extra]);
  return setRowConfig(next, { pkg: INSTRUCTIONS, path: ['instructionFileCandidates'], value: wanted }) ?? next;
}

/**
 * Add skill directories to the catalog this profile scans.
 *
 * `customSkillDirs` is additive and `includeDefaultRoots` stays on, so a topic
 * gets its own skills without losing the install's — the same delta rule the
 * rest of a set follows. Paths are passed through as the person wrote them: a
 * relative one is DSH's to resolve, and rewriting it here would guess wrong.
 */
export function setSkillDirs(patch, dirs) {
  const extra = cleanList(dirs);
  if (extra.length === 0) return String(patch ?? '');
  let next = String(patch ?? '');
  if (!rowExists(next, SKILLS)) {
    next = appendRow(next, { id: SKILL_ROW, pkg: SKILLS, config: { includeDefaultRoots: true } }) ?? next;
  }
  const wanted = unique([...listInRow(next, SKILLS, 'customSkillDirs'), ...extra]);
  return setRowConfig(next, { pkg: SKILLS, path: ['customSkillDirs'], value: wanted }) ?? next;
}
