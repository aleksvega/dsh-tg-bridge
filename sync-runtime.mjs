// Copy the runtime files of this checkout into the live bridge directory,
// keeping a timestamped backup of what it replaces.
//
//   node sync-runtime.mjs            # repo -> ~/.dsh/tg-bridge
//   node sync-runtime.mjs --dir X    # repo -> X
//
// Written in Node, not PowerShell: the files are UTF-8 with Cyrillic, and
// Set-Content would mangle them. The version in package.json comes along too —
// `/version` reads it, and a module-only sync would leave it describing the
// previous release.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const flag = process.argv.indexOf('--dir');
const target = flag > -1 && process.argv[flag + 1]
  ? process.argv[flag + 1]
  : join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'tg-bridge');

if (!existsSync(target)) mkdirSync(target, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
// Copy what `package.json` says the package is made of, not just the root .mjs
// files: a module in a subdirectory (`i18n/en.mjs`) is imported by name, so a
// root-only sync leaves the runtime with an import that cannot resolve and the
// bridge refuses to start after `/restart confirm`. Directories are copied
// recursively, and everything else in the runtime (config, state, logs) is left
// alone because it is not in `files[]`.
const entries = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).files || [];
let copied = 0;
const copyOne = (from, to) => {
  if (existsSync(to)) copyFileSync(to, `${to}.bak-${stamp}`);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied += 1;
};

const copyTree = (fromDir, toDir) => {
  for (const name of readdirSync(fromDir, { withFileTypes: true })) {
    const from = join(fromDir, name.name);
    const to = join(toDir, name.name);
    if (name.isDirectory()) copyTree(from, to);
    else copyOne(from, to);
  }
};

// package.json is not in files[] (npm adds it itself) but /version reads it.
for (const entry of ['package.json', ...entries]) {
  const from = join(here, entry);
  if (!existsSync(from)) continue;
  if (entry.endsWith('/')) copyTree(from, join(target, entry.replace(/\/$/, '')));
  else copyOne(from, join(target, entry));
}

const version = (() => {
  try {
    return JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
})();
console.log(`synced ${copied} files into ${target} (version ${version}, backup stamp ${stamp})`);
console.log('restart the bridge to load them: /restart confirm in Telegram');
