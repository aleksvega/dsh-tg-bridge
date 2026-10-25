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
const names = readdirSync(here).filter((name) => name.endsWith('.mjs') || name === 'package.json');
let copied = 0;

for (const name of names) {
  if (name === 'sync-runtime.mjs') continue;
  const to = join(target, name);
  if (existsSync(to)) copyFileSync(to, `${to}.bak-${stamp}`);
  copyFileSync(join(here, name), to);
  copied += 1;
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
