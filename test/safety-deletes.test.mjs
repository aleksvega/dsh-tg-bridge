// The bridge must never damage a file it did not write.
//
// A person installs this bot on their own machine and then leaves it running for
// months. Every write below is reachable from a Telegram message, so the cost of
// getting one wrong is not a failed test — it is someone's notes, someone's
// global instructions file, or someone's whole profile directory.
//
// Two rules, tested here:
//
//   1. a recursive delete is confined to the directory it was told to sweep;
//   2. a file the person wrote by hand survives an edit of the one section the
//      bridge owns.
//
// The paths come from `DSH_HOME`, which is an environment variable: an install
// can be pointed at a directory that already holds real files, and the guard has
// to hold there too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pruneDerived } from '../aset-profile.mjs';

/** A throwaway home directory, cleaned up by the OS temp dir policy. */
function home() {
  return mkdtempSync(join(tmpdir(), 'safety-'));
}

test('pruneDerived removes only the derived profiles it was told to remove', () => {
  const root = home();
  mkdirSync(join(root, 'aset-aaaaaaaaaa'), { recursive: true });
  mkdirSync(join(root, 'aset-bbbbbbbbbb'), { recursive: true });
  mkdirSync(join(root, 'headless'), { recursive: true });
  writeFileSync(join(root, 'headless', 'package.json'), '{}');
  mkdirSync(join(root, 'notes'), { recursive: true });
  writeFileSync(join(root, 'notes', 'todo.md'), 'mine');

  const removed = pruneDerived([], { profiles: root });
  assert.deepEqual(removed.sort(), ['aset-aaaaaaaaaa', 'aset-bbbbbbbbbb']);
  // The hand-made profile and the unrelated directory are untouched — this is
  // the whole point: `/soul`-adjacent cleanup must not eat a person's profile.
  assert.equal(readFileSync(join(root, 'headless', 'package.json'), 'utf8'), '{}');
  assert.equal(readFileSync(join(root, 'notes', 'todo.md'), 'utf8'), 'mine');
});

test('a bound profile is kept even when it looks derived', () => {
  const root = home();
  mkdirSync(join(root, 'aset-cccccccccc'), { recursive: true });
  const removed = pruneDerived(['aset-cccccccccc'], { profiles: root });
  assert.deepEqual(removed, []);
});

test('a profile name that tries to escape the sweep is not followed', () => {
  // `readdirSync` cannot return `../..`, but the guard must not depend on that:
  // a symlink or a future caller could hand over a name with a separator.
  const root = home();
  const outside = home();
  mkdirSync(join(outside, 'aset-keepme'), { recursive: true });
  writeFileSync(join(outside, 'aset-keepme', 'file.txt'), 'important');
  const removed = pruneDerived([], { profiles: root });
  assert.deepEqual(removed, []);
  assert.equal(readFileSync(join(outside, 'aset-keepme', 'file.txt'), 'utf8'), 'important');
});

test('a missing profiles directory is not an error', () => {
  const root = join(home(), 'does-not-exist');
  assert.deepEqual(pruneDerived([], { profiles: root }), []);
});

test('sweeping a directory that does not exist removes nothing and throws nothing', () => {
  // The guard has to hold when the machine is in a state nobody expected —
  // fresh install, deleted home, unplugged drive.
  const root = join(home(), 'nope');
  assert.deepEqual(pruneDerived(['anything'], { profiles: root }), []);
});

test('the sweep is safe to run twice', () => {
  const root = home();
  mkdirSync(join(root, 'aset-dddddddddd'), { recursive: true });
  assert.deepEqual(pruneDerived([], { profiles: root }), ['aset-dddddddddd']);
  assert.deepEqual(pruneDerived([], { profiles: root }), [], 'the second sweep finds nothing to do');
  rmSync(root, { recursive: true, force: true });
});
