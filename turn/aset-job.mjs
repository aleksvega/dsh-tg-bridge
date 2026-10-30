// `dsh-tg aset materialise` — build a bound set's profile outside the turn.
//
// A plugin job (or `say.mjs`) runs while the bridge's turn process is alive, and
// DSH refuses to start a second copy of itself under a live parent: the bridge
// sees that as a crash, not as a profile. So the one action that must happen
// before a turn — writing `<base>` + the set's rows into a profile of their own
// — is spawned as a detached child, and this CLI is that child.
//
// Usage (from a job file the agent writes, see docs/AGENTSET.md):
//   node cli.mjs aset materialise <setId> [--base <profile>]
// Prints one JSON line: {ok, profile, base} or {ok: false, error}.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AgentsetStore } from '../profile/agentsets.mjs';
import { materialiseProfile, pruneDerived } from '../profile/aset-profile.mjs';

const SELF = fileURLToPath(import.meta.url);

/** The store lives next to `state.json`, and only the bridge knows where that is. */
function storeDir() {
  return process.env.DSH_TG_HOME || process.env.DSH_TG_DIR || '';
}

function run(args) {
  const [verb, id] = args;
  if (verb !== 'materialise') return { ok: false, error: 'usage', usage: 'aset materialise <setId> [--base <profile>]' };
  const dir = storeDir();
  if (!dir) return { ok: false, error: 'no-dir', hint: 'DSH_TG_HOME is not set' };
  const flag = args.indexOf('--base');
  const base = flag >= 0 ? args[flag + 1] : '';
  if (!base) return { ok: false, error: 'no-base' };
  const store = new AgentsetStore(`${dir}/agentsets.json`);
  const set = store.load().get(id);
  if (!set) return { ok: false, error: 'missing', id };
  const profile = materialiseProfile(set, base);
  if (!profile) return { ok: true, profile: '', base, note: 'nothing to materialise' };
  // The sweep keeps every profile a bound set still points at; the caller's own
  // job listed them, so this pass is best-effort and never fails the build.
  try {
    pruneDerived([profile]);
  } catch {
    // A profile in use by a running turn is removed on the next sweep.
  }
  return { ok: true, profile, base, set: id };
}

/**
 * Spawn the same file for one `aset` job and forget about it. A live bridge
 * calls this; nothing inside a turn does.
 */
export function spawnAset(args, { dir = storeDir(), node = process.execPath } = {}) {
  const child = spawn(node, [SELF, 'aset', ...args], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, DSH_TG_HOME: dir },
  });
  child.unref();
  return child.pid;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'aset') {
    process.stdout.write(`${JSON.stringify(run(rest))}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'usage', usage: 'aset materialise <setId> --base <profile>' })}\n`);
  }
}