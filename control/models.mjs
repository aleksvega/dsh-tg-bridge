// Reading and changing a profile's model: the patch row, the overlay, the window.
//
// Split out of `control.mjs` by the 500-line plan: the command handlers that
// follow call these, and none of them needs the dispatcher to do it.
import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../i18n.mjs';
import { providerRows } from '../model-probe.mjs';
import { PROFILES } from '../paths.mjs';

export const read = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};
export const readJson = (path) => {
  try {
    return JSON.parse(read(path).replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
};
export const patchPath = (profile) => join(PROFILES, profile, 'cordis.patch.yml');
export const pkgPath = (profile) => join(PROFILES, profile, 'package.json');
// Written by `ensureProfile()` in profiles.mjs when it materialises a model
// overlay as a profile of its own.
export const OVERLAY_MARK = ': per-turn model overlay ----';

/** Model ids declared under `llm-pi-ai.providers.<provider>.models` in a patch. */
export function modelsOf(profile) {
  const text = read(patchPath(profile));
  const lines = text.split('\n');
  const ids = [];
  let inModels = false;
  for (const line of lines) {
    if (/^\s{8}models:\s*$/.test(line)) {
      inModels = true;
      continue;
    }
    if (inModels) {
      const match = /^\s{10}- id:\s*(\S+)/.exec(line);
      if (match) ids.push(match[1]);
      else if (/^\s{0,8}\S/.test(line) && line.trim() && !line.trim().startsWith('- id:')) inModels = false;
    }
  }
  return ids;
}

/** Current default model of a profile. */
export function modelOf(profile) {
  const text = read(patchPath(profile));
  const block = /- id: agent-default-model[\s\S]*?(?=\n- id:|\n- insert:|$)/.exec(text);
  const model = block && /^\s+model:\s*(\S+)/m.exec(block[0]);
  const provider = block && /^\s+provider:\s*(\S+)/m.exec(block[0]);
  return { provider: provider ? provider[1] : '?', model: model ? model[1] : '?' };
}

/**
 * Every route a profile can run, as provider + model pairs.
 *
 * `modelsOf` answers "which model ids exist", and that is the wrong question to
 * put on a screen: the same id is declared by several providers — `deepseek-v4.1-flash`
 * exists on wikivibe and on unorouter — so a list of ids shows the same name
 * twice and neither row says where the answers would come from. Picking a model
 * and picking a route is one decision, so the list is made of routes.
 *
 * The lookup is indentation-driven, like `windowOf`: provider rows sit at one
 * depth under `providers:`, model rows two spaces deeper under their
 * provider's `models:`. A profile with no provider block, or a model declared
 * outside one, still yields a row with an empty provider rather than vanishing.
 */
export function routesOf(profile) {
  const lines = read(patchPath(profile)).split(/\r?\n/);
  const head = modelOf(profile);
  const out = [];
  let atProviders = -1;
  let rowIndent = -1;
  let provider = '';
  let modelsIndent = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = (/^\s*/.exec(line) || [''])[0].length;
    if (atProviders < 0) {
      if (/^providers:\s*$/.test(trimmed)) atProviders = indent;
      continue;
    }
    // The provider block ends at the first line shallower than a provider row.
    if (rowIndent < 0) rowIndent = indent;
    if (indent < rowIndent) {
      atProviders = -1;
      provider = '';
      modelsIndent = -1;
      continue;
    }
    if (indent === rowIndent) {
      const row = /^([\w.-]+):\s*$/.exec(trimmed);
      provider = row ? row[1] : '';
      modelsIndent = -1;
      continue;
    }
    if (!provider) continue;
    if (/^models:\s*$/.test(trimmed)) {
      modelsIndent = indent;
      continue;
    }
    if (modelsIndent < 0) continue;
    // Back at the model list's own depth: the list is over.
    if (indent <= modelsIndent) {
      modelsIndent = -1;
      continue;
    }
    const id = /^-\s*id:\s*(\S+)/.exec(trimmed);
    if (id) {
      out.push({
        provider,
        model: id[1],
        current: provider === head.provider && id[1] === head.model,
      });
    }
  }
  return out;
}

/**
 * The context window this profile actually runs with.
 *
 * It lives in the profile's own patch — `defaultContextWindow`, and a
 * `contextWindow` per model that overrides it — never in the bridge config. The
 * old code looked only at config and told every install to fix a file that has
 * no such key, which read as "the bot does not know" when the bot was simply
 * asking the wrong place.
 *
 * A profile whose model has no explicit window is left to the model registry, so
 * the answer is empty rather than a guess: an invented denominator turns into a
 * wrong percentage.
 */
export function windowOf(profile, model) {
  const lines = read(patchPath(profile)).split(/\r?\n/);

  // The provider's own default, which DSH writes as `defaultContextWindow`; a
  // bare `contextWindow` on the provider is the same thing spelled differently.
  // The provider key and a per-model key are told apart by indentation alone:
  // model rows sit two spaces deeper than the `- ` that starts them.
  const windowRows = lines
    .map((line) => /^(\s*)(?:defaultContextWindow|contextWindow):\s*(\d+)/.exec(line))
    .filter(Boolean);
  const fallback = Number((windowRows.find((row) => row[1].length < modelIndent(lines)) || [])[2] || 0);

  if (!model) return fallback;

  // A model entry is a YAML row whose `name` is the id, with `contextWindow` at
  // the same indentation a line or two below. Many entries, one match.
  const wanted = new RegExp(`^\\s*(?:-\\s+)?name:\\s*${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const nameAt = lines.findIndex((line) => wanted.test(line));
  if (nameAt < 0) return fallback;
  const indent = depthOf(lines[nameAt]);
  for (let i = nameAt + 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    const at = depthOf(lines[i]);
    if (at < indent) break;
    const own = /^\s*contextWindow:\s*(\d+)/.exec(lines[i]);
    if (own && at <= indent + 2) return Number(own[1]);
  }
  return fallback;
}

/**
 * The indentation a profile's model rows are written at.
 *
 * Read from the file rather than assumed: the first row of the list that the
 * provider default introduces sets it, and its keys sit two spaces deeper. A
 * profile with no list at all falls back to the shape every DSH profile has.
 */
export function modelIndent(lines) {
  const at = lines.findIndex((line) => /^\s*defaultContextWindow:/.test(line));
  const from = at >= 0 ? at + 1 : 0;
  const row = lines.slice(from).find((line) => /^\s*-\s+(?:id|name):/.test(line));
  const spaces = row ? /^\s*/.exec(row)[0].length : 10;
  return spaces + 2;
}

/** Spaces of indentation a line starts with; the leaf row of a list reads one deeper. */
export function depthOf(text) {
  const spaces = /^\s*/.exec(String(text))[0].length;
  return /^\s*-\s/.test(String(text)) ? spaces + 2 : spaces;
}

/** The `/model` list: what this profile runs and what else it could run. */
export function modelsReport(lang, profile) {
  const head = modelOf(profile);
  const ids = modelsOf(profile);
  return [
    ids.length > 0
      ? t(lang, 'ctrl.models.current', { model: head.model })
      : t(lang, 'ctrl.models.none', { name: profile }),
    ...(ids.length > 0
      ? [t(lang, 'ctrl.models.available'), ...ids.map((id) => `  ${id === head.model ? '*' : ' '} ${id}`)]
      : []),
  ].join('\n');
}

/**
 * Rewrite the default model of a profile; returns false for an unknown id.
 *
 * `provider/model` moves the route as well as the model. Without that a person
 * who wants the SAME model on a different router has no way to say so: `/model
 * deepseek-v4.1-flash` keeps whatever provider the patch already had, so the
 * switch silently keeps the slow host — the one case where "I changed the model"
 * and "the answers come from somewhere else now" are different claims.
 */
export function setModel(profile, wanted) {
  const text0 = String(wanted || '').trim();
  const slash = text0.indexOf('/');
  const provider = slash > 0 ? text0.slice(0, slash) : '';
  const model = slash > 0 ? text0.slice(slash + 1) : text0;
  if (!model) return false;
  const ids = modelsOf(profile);
  if (ids.length > 0 && !ids.includes(model)) return false;
  const path = patchPath(profile);
  const text = read(path);
  // A provider the profile does not declare cannot boot the turn: writing it
  // anyway would leave a patch that looks edited and a bot that cannot answer,
  // so the row is checked before the file is touched.
  if (provider && !providerRows(text).some((row) => row.id === provider)) return false;
  const block = /- id: agent-default-model[\s\S]*?(?=\n- id:|\n- insert:|$)/.exec(text);
  if (!block) return false;
  // Provider first, then model: both live in the same block, and replacing the
  // block wholesale would drop `reasoningEffort` and anything else a person set.
  let next = block[0].replace(/^(\s+model:\s*)\S+/m, `$1${model}`);
  if (provider) {
    if (/^\s+provider:\s*\S+/m.test(next)) next = next.replace(/^(\s+provider:\s*)\S+/m, `$1${provider}`);
    else next = next.replace(/^(\s+model:\s*\S+)/m, `$1\n    provider: ${provider}`);
  }
  if (next === block[0]) return false;
  writeFileSync(path, text.replace(block[0], next), 'utf8');
  return true;
}

/** Top-level patch entry ids that carry `disabled:` in a profile. */
export function disabledIds(profile) {
  const text = read(patchPath(profile));
  const out = [];
  const entries = text.split(/\n(?=- )/);
  for (const entry of entries) {
    const id = /^- id:\s*(\S+)/.exec(entry);
    // Only a two-space indent is the entry's own key; deeper ones belong to the
    // nested plugin rows of a group entry and are not the entry being disabled.
    if (id && /^ {2}disabled:\s*true\s*$/m.test(entry)) out.push(id[1]);
  }
  return out;
}

/**
 * Enable or disable one loader row of a profile.
 * The patch is an ordered list where later entries win, so a disable is an
 * appended `- id: <id>\n  disabled: true`, and an enable removes that key from
 * the last entry mentioning the id.
 */
export function setDisabled(profile, id, disabled) {
  const path = patchPath(profile);
  const text = read(path);
  const entries = text.split(/\n(?=- )/);
  const idx = entries.map((entry, i) => ({ entry, i })).filter(({ entry }) => new RegExp(`^- id:\\s*${id}\\s*$`, 'm').test(entry));
  if (idx.length === 0) return false;
  const last = idx[idx.length - 1];
  if (disabled) {
    if (/^\s+disabled:\s*true\s*$/m.test(last.entry)) return true;
    entries.push(`- id: ${id}\n  disabled: true`);
  } else {
    entries[last.i] = last.entry.replace(/^\s+disabled:\s*(true|false)\s*\n?/m, '');
  }
  writeFileSync(path, entries.join('\n'), 'utf8');
  return true;
}

/**
 * Replace a profile patch atomically, keeping the previous file as `.bak`.
 * A turn booting during the write must read either the old or the new file:
 * the patch decides what every later turn may do, and half a file is a profile
 * that fails to start.
 */
export function writePatch(profile, text) {
  const path = patchPath(profile);
  try { copyFileSync(path, `${path}.bak`); } catch {}
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
}
