// Copy every runtime module from the repo into the live bridge directory,
// keeping a timestamped backup of what it replaces. Node, not PowerShell: the
// files are UTF-8 with Cyrillic, and Set-Content would mangle them.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repo = 'C:\\Users\\bistr\\Projects\\dsh-tg-bridge-oss';
const run = 'C:\\Users\\bistr\\.dsh\\tg-bridge';
const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
const files = readdirSync(repo).filter((f) => f.endsWith('.mjs'));
let copied = 0;

for (const file of files) {
  const to = join(run, file);
  if (existsSync(to)) copyFileSync(to, `${to}.bak-${stamp}`);
  copyFileSync(join(repo, file), to);
  copied += 1;
}
mkdirSync(run, { recursive: true });
console.log(`synced ${copied} modules from the repo to the runtime (backup stamp ${stamp})`);
