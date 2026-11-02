// A machine that has never run the bridge has no `~/.dsh/tg-bridge`, so
// `state.json` cannot be written. That is a fresh install, not a failure: the
// card already reached the person, and remembering its rows is a convenience.
// CI caught this because its home directory is clean and the developer machine
// is not — the same code passed locally and failed on a fresh runner.
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('a state file that cannot be written does not fail the command', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'no-bridge-'));
  const before = process.env.DSH_HOME;
  process.env.DSH_HOME = empty;
  // Imported after the env is set: the paths module reads it once at load.
  const { saveState, state } = await import('../core/state.mjs?fresh');
  try {
    state.cwd = state.cwd || {};
    assert.equal(saveState(), false, 'a missing folder is a failed save, not a throw');
  } finally {
    if (before === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = before;
    rmSync(empty, { recursive: true, force: true });
  }
});
