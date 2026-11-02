// A goal about Germany sat on a topic about Latvia for days. The write that put
// it there succeeded: the card then showed that topic's own goal, correctly, and
// the only sign of the mistake was that the goal had nothing to do with the
// topic. A turn knows its topic and nothing else can know it better, so a --key
// that disagrees with the turn is refused unless someone says --force.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const GOAL = fileURLToPath(new URL('../goal.mjs', import.meta.url));

function run(args, key = '1001:2002') {
  const home = mkdtempSync(join(tmpdir(), 'dsh-goal-'));
  const result = spawnSync(process.execPath, [GOAL, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DSH_TG_HOME: home, DSH_TG_KEY: key },
  });
  return { ...result, home };
}

const jobs = (home) => (existsSync(join(home, 'goal-jobs')) ? readdirSync(join(home, 'goal-jobs')) : []);

test('a turn cannot file a task under another topic by naming it', () => {
  const run1 = run(['--key', '1001:3003', '--add', 'Germany, work, laws']);
  assert.equal(run1.status, 2, 'the write has to be refused, not applied');
  assert.match(run1.stderr, /refusing to write topic/);
  assert.deepEqual(jobs(run1.home), [], 'nothing may be queued for the other topic');
});

test('the same key the turn runs in is accepted', () => {
  const run1 = run(['--key', '1001:2002', '--add', 'a task for this topic']);
  assert.equal(run1.status, 0);
  assert.equal(jobs(run1.home).length, 1);
});

test('no key at all still means "this turn"', () => {
  const run1 = run(['--add', 'a task for this topic']);
  assert.equal(run1.status, 0);
  assert.equal(jobs(run1.home).length, 1);
});

test('a deliberate --force crosses topics', () => {
  const run1 = run(['--key', '1001:3003', '--add', 'moved on purpose', '--force']);
  assert.equal(run1.status, 0);
  assert.equal(jobs(run1.home).length, 1);
});

test('outside a turn there is no topic to disagree with', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-goal-'));
  const result = spawnSync(process.execPath, [GOAL, '--key', '1001:3003', '--add', 'from a terminal'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_TG_HOME: home, DSH_TG_KEY: '' },
  });
  assert.equal(result.status, 0);
  assert.equal(jobs(home).length, 1);
});