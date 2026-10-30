// Model overlays as profiles.
//
// A `--patch <file>` overlay was the way to run one turn on another model, but
// the desktop host CLI dropped that flag (0.2.x answers "unknown option
// '--patch'" and exits 1 with no output), which killed every photo turn and
// every free-model fallback. A profile is the host's own mechanism, so each
// overlay file is materialised once as a profile that carries the base
// headless config plus the overlay's rows.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { rewriteModelText } from '../control/models.mjs';

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const PROFILES = join(DSH_HOME, 'profiles');
const BASE = join(PROFILES, 'headless');

/** Stable, filesystem-safe profile name for one overlay file. */
function profileNameFor(patchPath) {
  const stem = basename(patchPath).replace(/\.ya?ml$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return `headless-${stem}`;
}

/**
 * The copied profile has no `node_modules` of its own — copying it would
 * duplicate hundreds of megabytes per overlay. A directory junction to the
 * base profile's modules keeps the *same* plugins (steer inbox, tool order,
 * sandbox hooks) instead of silently booting a bare host.
 */
function linkModules(dir) {
  const modules = join(dir, 'node_modules');
  if (existsSync(modules)) return;
  try {
    symlinkSync(join(BASE, 'node_modules'), modules, 'junction');
  } catch {
    // Without the link the profile still boots, just without the extra plugins.
  }
}

/**
 * Copy one profile's files into a new directory. The patch is left to the
 * caller: every variant below derives it differently, and copying the base
 * patch first and editing it afterwards is how a variant ends up half-written.
 */
function copyProfile(baseDir, dir) {
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    const from = join(baseDir, entry.name);
    const to = join(dir, entry.name);
    if (entry.isFile() && !entry.name.endsWith('.bak') && !entry.name.includes('.bak-')) {
      if (entry.name !== 'cordis.patch.yml') copyFileSync(from, to);
    } else if (entry.isDirectory() && entry.name === '.plugin-manager') {
      // Plugin resolution state is per profile; a copy keeps the same plugins.
      mkdirSync(to, { recursive: true });
      for (const inner of readdirSync(from, { withFileTypes: true })) {
        if (inner.isFile()) copyFileSync(join(from, inner.name), join(to, inner.name));
      }
    }
  }
  linkModules(dir);
}

/**
 * A profile directory looks like the base one: the same patch list plus the
 * overlay rows appended at the end (a later row wins), so the turn keeps every
 * sandbox/steer/tool-order setting and only the model changes.
 */
function ensureProfile(patchPath) {
  if (!patchPath || !existsSync(patchPath) || !existsSync(BASE)) return '';
  const name = profileNameFor(patchPath);
  const dir = join(PROFILES, name);
  const target = join(dir, 'cordis.patch.yml');
  if (existsSync(target)) {
    linkModules(dir);
    return name;
  }
  copyProfile(BASE, dir);
  const overlay = readFileSync(patchPath, 'utf8').trimEnd();
  // The base patch is the base profile's own, never whatever is already in the
  // copy: a copy that was written once keeps its rows, and appending the overlay
  // to those would stack a second model row on every rebuild.
  const base = readFileSync(join(BASE, 'cordis.patch.yml'), 'utf8').trimEnd();
  writeFileSync(
    target,
    `${base}\n\n# ---- ${basename(patchPath)}: per-turn model overlay ----\n${overlay}\n`,
    'utf8',
  );
  return name;
}

/**
 * A profile that is `base` with the default model moved to `route` — the
 * per-topic choice.
 *
 * A topic cannot carry a model of its own any other way: the host reads the
 * model from the profile it boots, and the one flag that used to override it
 * (`--patch`) is gone. So the choice becomes a profile, and the profile is a
 * copy of the one the topic already used with exactly one row rewritten —
 * `reasoningEffort` and every other setting the person chose come along.
 *
 * Regenerated whenever the copy and the base disagree, so editing the profile
 * later still reaches a topic that picked a route.
 */
export function ensureRouteProfile(base, route) {
  const from = String(base || 'headless').replace(/-route-.*$/, '');
  const provider = String(route?.provider || '');
  const model = String(route?.model || '');
  if (!model) return '';
  const baseDir = join(PROFILES, from);
  const source = join(baseDir, 'cordis.patch.yml');
  if (!existsSync(source)) return '';
  const next = rewriteModelText(readFileSync(source, 'utf8'), { provider, model });
  if (!next) return '';
  const slug = `${provider}-${model}`.replace(/[^a-z0-9.-]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
  const name = `${from}-route-${slug}`;
  const dir = join(PROFILES, name);
  const target = join(dir, 'cordis.patch.yml');
  const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
  if (current === next) {
    linkModules(dir);
    return name;
  }
  copyProfile(baseDir, dir);
  writeFileSync(target, next, 'utf8');
  return name;
}

export { ensureProfile, profileNameFor };
