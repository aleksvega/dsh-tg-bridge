// What a plugin row of a profile actually has configured.
//
// The desktop app draws a settings page per plugin from the plugin's own schema.
// The bridge has no such channel — a headless turn has no client to ask — so it
// reads the one file that decides what the host loads: the profile's
// `cordis.patch.yml`. A row's flat `config:` keys ARE the settings, with the
// value the loader will use, and they are shown as what they are:
//
//   * a boolean is a switch, because a tap can change it;
//   * anything else is a value, because there is no honest way to type a new one
//     from a button — a row that looked editable and was not is the dead control
//     this feature exists to avoid.
//
// A key whose value is a nested block (a provider table, a model list) is not a
// setting: it is a structure with its own editor elsewhere, and it is reported as
// a value with the number of lines it holds, never as something to flip.
//
// Reading and writing live here, and the write is always followed by a read of
// the file as it now is: the answer names the value the file holds, not the value
// that was requested, so a YAML shape the line editor could not express reads as
// "refused" instead of as success.
import { existsSync, writeFileSync } from 'node:fs';
import { patchPath, read } from './models.mjs';
import { setRowConfig } from '../profile/profile-edit.mjs';

/** The row a plugin is identified by, as a callback and a command can carry it. */
const ROW_ID = /^[a-z][a-z0-9._-]{1,60}$/i;
/** A config key, as YAML writes it. */
const KEY = /^[A-Za-z_][A-Za-z0-9_.-]{0,60}$/;

/** How many lines a nested block holds, counted for the "value, not a switch" row. */
function countBlock(lines, from, indent) {
  let n = 0;
  for (let i = from + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s*/.exec(line)[0].length <= indent) break;
    n += 1;
  }
  return n;
}

/** A scalar as YAML wrote it: `true` is a boolean, `4000` a number, the rest text. */
function scalarOf(raw) {
  const text = raw.trim();
  if (text === 'true') return { value: true, type: 'boolean' };
  if (text === 'false') return { value: false, type: 'boolean' };
  if (/^-?\d+(\.\d+)?$/.test(text)) return { value: Number(text), type: 'number' };
  // Quoted and bare strings alike: the quotes are YAML's, not the value's.
  const bare = /^(['"])(.*)\1$/.exec(text);
  return { value: bare ? bare[2] : text, type: 'string' };
}

/**
 * The `config:` keys of one plugin row, in file order.
 *
 * @param {string} text the profile patch
 * @param {string} rowId the row's `- id:`
 * @returns {{ok: boolean, why?: string, id: string, pkg: string, settings: object[]}}
 */
export function pluginConfig(text, rowId) {
  const source = String(text ?? '');
  const id = String(rowId ?? '').trim();
  const empty = { ok: false, why: 'unknownRow', id, pkg: '', settings: [] };
  if (!ROW_ID.test(id)) return { ...empty, why: 'badId' };
  const lines = source.split(/\r?\n/);

  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)-\s*id:\s*(\S+)\s*$/.exec(lines[i]);
    if (!m || m[2] !== id) continue;
    // A later row with the same id wins, the way the loader reads the file top
    // to bottom: the last row for a plugin is the one in force.
    start = i;
  }
  if (start < 0) return empty;
  const rowIndent = /^\s*/.exec(lines[start])[0].length;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    const indent = /^\s*/.exec(lines[i])[0].length;
    if (indent <= rowIndent && /^\s*-\s*(id|name):/.test(lines[i])) {
      end = i;
      break;
    }
  }

  let pkg = '';
  let configAt = -1;
  for (let i = start + 1; i < end; i += 1) {
    const name = /^\s*name:\s*['"]?([^'"\s]+)['"]?\s*$/.exec(lines[i]);
    if (name && !pkg) pkg = name[1];
    if (/^\s*config:\s*$/.test(lines[i]) && configAt < 0) configAt = i;
  }
  if (configAt < 0) return { ok: true, why: 'noConfig', id, pkg, settings: [] };
  const configIndent = /^\s*/.exec(lines[configAt])[0].length;
  const childIndent = configIndent + 2;

  const settings = [];
  for (let i = configAt + 1; i < end; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = /^\s*/.exec(line)[0].length;
    if (indent <= configIndent) break;
    // A deeper line belongs to the key above it, which already counted it.
    if (indent !== childIndent) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_.-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (rawValue.trim() === '' || rawValue.trim().startsWith('#')) {
      // A nested block or a list: a structure, and this card does not edit one.
      settings.push({ key, type: 'block', value: '', lines: countBlock(lines, i, indent), editable: false });
      continue;
    }
    const scalar = scalarOf(rawValue.replace(/\s+#.*$/, ''));
    settings.push({
      key,
      type: scalar.type,
      value: scalar.value,
      editable: scalar.type === 'boolean',
    });
  }
  return { ok: true, id, pkg, settings };
}

/** The same, read from the profile's own file. */
export function pluginConfigOf(profile, rowId) {
  const path = patchPath(profile);
  if (!existsSync(path)) return { ok: false, why: 'missingProfile', id: String(rowId ?? ''), pkg: '', settings: [] };
  return pluginConfig(read(path), rowId);
}

/**
 * Every row of a profile that has a flat config a person can read, so the card
 * can offer the list without a plugin channel.
 *
 * Rows with nothing configured are left out: a row with no settings is a plugin
 * whose settings live in code, and a card that listed it would offer a page that
 * says nothing.
 */
export function settingsRows(profile) {
  const text = read(patchPath(profile));
  const ids = [...text.matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  const out = [];
  for (const id of new Set(ids)) {
    const found = pluginConfig(text, id);
    if (found.ok && found.settings.length > 0) out.push({ id, pkg: found.pkg, count: found.settings.length });
  }
  return out;
}

/**
 * Write one key and then report what the file holds.
 *
 * @param {string} profile the profile whose patch is edited — never another one
 * @param {string} rowId the plugin row
 * @param {string} key the config key
 * @param {string|number|boolean} value the value to write
 * @returns {{ok: boolean, why?: string, requested?: any, value?: any, changed?: boolean}}
 */
export function writePluginSetting(profile, rowId, key, value) {
  const path = patchPath(profile);
  if (!existsSync(path)) return { ok: false, why: 'missingProfile' };
  const before = pluginConfig(read(path), rowId);
  if (!before.ok) return { ok: false, why: before.why || 'unknownRow' };
  const known = before.settings.find((s) => s.key === key);
  // Only a key the row reports, and only one a tap can actually change: writing
  // an unknown key would add a setting no plugin reads, which is a lie told in
  // YAML.
  if (!known) return { ok: false, why: 'unknownKey' };
  if (!known.editable) return { ok: false, why: 'readOnly', value: known.value };

  const next = setRowConfig(read(path), {
    pkg: before.pkg,
    path: [key],
    value,
    match: (row) => row.id === rowId,
  });
  if (next === null) return { ok: false, why: 'noEdit' };
  writeFileSync(path, next, 'utf8');

  // The value believed is the value read back, never the one requested.
  const after = pluginConfig(read(path), rowId);
  const now = after.settings?.find((s) => s.key === key);
  if (!after.ok || !now) return { ok: false, why: 'lost', requested: value };
  if (now.value !== value) return { ok: false, why: 'refused', requested: value, value: now.value };
  return { ok: true, changed: known.value !== value, requested: value, value: now.value };
}

/** A key a command or a callback may name. */
export function checkKey(key) {
  const value = String(key ?? '').trim();
  if (!value) return { ok: false, why: 'empty' };
  if (!KEY.test(value)) return { ok: false, why: 'badKey' };
  return { ok: true, key: value };
}
