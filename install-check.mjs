// An update must never leave the person with a bot that does not come back.
//
// `/update confirm` copies a fetched release over the running install and then
// asks for `/restart`. If the new files cannot load, the restart kills a working
// bridge and starts nothing — and the person is left in a terminal, on a machine
// they installed a Telegram bot to avoid touching. That is not hypothetical: the
// 1.29.0 candidate imported a name that did not exist, 557 tests stayed green,
// and only a hand-run smoke import caught it.
//
// So the install is checked in two steps, both cheap and both before the new
// files are trusted:
//
//   1. `isBridgeRoot` — the target is a bridge install at all, because the path
//      comes from an environment variable and an update aimed at the wrong
//      directory would scatter `docs/`, `test/` and `plugin/` into it;
//   2. `checkInstall` — every relative import in the release resolves to a file
//      that exports the name, and the entry points parse.
//
// Nothing here imports the bridge: importing `bridge.mjs` starts a poller.
import { cpSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, normalize, parse, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/** The file every bridge install has, and the cheapest proof of identity. */
const MARKER = 'bridge.mjs';

/**
 * Does this directory look like a bridge install?
 *
 * Deliberately not "does it exist": the caller is about to write files into it,
 * and a home directory or a drive root must be refused rather than filled.
 */
export function isBridgeRoot(root) {
  try {
    return existsSync(join(root, MARKER)) && statSync(join(root, MARKER)).isFile();
  } catch {
    return false;
  }
}

/**
 * Is this a directory an update may write into at all?
 *
 * `isBridgeRoot` answers "does it look like a bridge", which a checkout, a copy
 * or a nested install also answers yes to. This asks the blunter question: is it
 * a filesystem root or the person's home directory — the two places where "it
 * happened to contain a bridge.mjs" would mean writing the package over
 * everything else that lives there.
 *
 * @param {string} root
 * @param {{home?: string}} [env] for tests
 */
export function safeUpdateRoot(root, env = {}) {
  if (!root) return false;
  const home = env.home || homedir();
  const abs = resolve(root);
  // A drive root or '/' — `parse('/x').root` is '/', `parse('C:\\x').root` is 'C:\\'.
  if (abs === parse(abs).root) return false;
  if (home && abs === resolve(home)) return false;
  return true;
}

/** Names a module exports, as far as a regex can honestly tell. */
function exportsOf(text) {
  const names = new Set();
  for (const match of text.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(match[1]);
  }
  for (const match of text.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of match[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const alias = /\sas\s+([A-Za-z_$][\w$]*)$/.exec(piece);
      names.add(alias ? alias[1] : piece);
    }
  }
  // A star re-export could carry anything; call it unknowable rather than guess,
  // so the check never blocks a release over a false alarm.
  if (/^export\s+\*\s+from/m.test(text)) names.add('*');
  if (/^export\s+default\b/m.test(text)) names.add('default');
  return names;
}

/** The modules an install ships: the root, plus the two directories it uses. */
function shippedFiles(root) {
  const out = [];
  const push = (rel) => {
    if (rel.endsWith('.mjs')) out.push(rel);
  };
  for (const name of readdirSync(root)) push(name);
  for (const sub of ['control', 'i18n', 'i18n/en', 'i18n/ru', 'i18n/zh']) {
    try {
      for (const name of readdirSync(join(root, sub))) push(`${sub}/${name}`);
    } catch {}
  }
  return out;
}

/**
 * Can this install load?
 *
 * Reports problems instead of throwing: a failed update should say what is wrong
 * with the release it fetched, in words the person can paste into an issue, and
 * then put the old files back.
 *
 * @param {string} root
 * @returns {{ok: boolean, problems: string[]}}
 */
export function checkInstall(root) {
  if (!safeUpdateRoot(root)) return { ok: false, problems: [`refusing to write into ${root}: that is a filesystem root or the home directory`] };
  if (!isBridgeRoot(root)) return { ok: false, problems: [`${MARKER} is missing — this is not a bridge install`] };
  const problems = [];
  let files = [];
  try {
    files = shippedFiles(root);
  } catch (error) {
    return { ok: false, problems: [`cannot read ${root}: ${String(error.message).slice(0, 120)}`] };
  }

  const cache = new Map();
  for (const rel of files) {
    let text = '';
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch {
      problems.push(`${rel}: unreadable`);
      continue;
    }
    for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'(\.[^']*)'/g)) {
      const target = normalize(join(dirname(rel), match[2])).split('\\').join('/');
      const file = target.endsWith('.mjs') || target.endsWith('.js') ? target : `${target}.mjs`;
      const full = join(root, file);
      if (!existsSync(full)) {
        problems.push(`${rel}: imports ${file}, which is not in the release`);
        continue;
      }
      let exported = cache.get(file);
      if (!exported) {
        try {
          exported = exportsOf(readFileSync(full, 'utf8'));
        } catch {
          continue;
        }
        cache.set(file, exported);
      }
      for (const part of match[1].split(',')) {
        const piece = part.trim();
        if (!piece) continue;
        const name = piece.split(/\s+as\s+/)[0].trim();
        if (exported.has('*') || exported.has(name)) continue;
        problems.push(`${rel}: imports ${name} from ${file}, which does not export it`);
      }
    }
  }

  // A syntax error is invisible to the scan above and is the other way a release
  // arrives dead. `node --check` on the entry points costs about a second and
  // covers the modules a turn actually goes through.
  for (const entry of [MARKER, 'handle-message.mjs', 'control.mjs']) {
    if (!existsSync(join(root, entry))) continue;
    try {
      const r = spawnSync(process.execPath, ['--check', join(root, entry)], { encoding: 'utf8', timeout: 20000, windowsHide: true });
      if (r.status !== 0) {
        const line = `${r.stderr || ''}`.split(/\r?\n/).find((row) => /Error/.test(row)) || 'syntax error';
        problems.push(`${entry}: ${line.trim().slice(0, 160)}`);
      }
    } catch {
      // A `node --check` that cannot run is not a verdict on the release.
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Put the previous files back, after a release failed to load.
 *
 * The backup stays where it is: it is the only good copy, and someone recovering
 * from a broken update should not have to wonder whether the restore ate it.
 *
 * @param {string} root
 * @param {string} backupDir
 * @returns {string[]} entries that were restored
 */
export function restoreBackup(root, backupDir) {
  const restored = [];
  let entries = [];
  try {
    entries = readdirSync(backupDir);
  } catch {
    return restored;
  }
  for (const name of entries) {
    try {
      cpSync(join(backupDir, name), join(root, name), { recursive: true });
      restored.push(name);
    } catch {}
  }
  return restored;
}
