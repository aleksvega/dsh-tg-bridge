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
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(BASE, { withFileTypes: true })) {
    const from = join(BASE, entry.name);
    const to = join(dir, entry.name);
    if (entry.isFile() && !entry.name.endsWith('.bak') && !entry.name.includes('.bak-')) {
      copyFileSync(from, to);
    } else if (entry.isDirectory() && entry.name === '.plugin-manager') {
      // Plugin resolution state is per profile; a copy keeps the same plugins.
      mkdirSync(to, { recursive: true });
      for (const inner of readdirSync(from, { withFileTypes: true })) {
        if (inner.isFile()) copyFileSync(join(from, inner.name), join(to, inner.name));
      }
    }
  }
  const overlay = readFileSync(patchPath, 'utf8').trimEnd();
  const base = existsSync(target) ? readFileSync(target, 'utf8').trimEnd() : '';
  writeFileSync(
    target,
    `${base}\n\n# ---- ${basename(patchPath)}: per-turn model overlay ----\n${overlay}\n`,
    'utf8',
  );
  linkModules(dir);
  return name;
}

export { ensureProfile, profileNameFor };
