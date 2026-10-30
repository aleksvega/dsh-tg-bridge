// A release that does not run must not stay installed.
//
// 1.30.0 shipped a call to a function that did not exist. Every import resolved,
// every file parsed, 588 tests passed — and the first real message threw, so the
// person was left on a version that answered nothing. The check in
// `install-check.mjs` cannot see a name that is never defined inside a function
// body; only a turn that runs can.
//
// So the rule is: a version earns its place by answering a turn, and a version
// that only ever throws is replaced by the last one that did. The lines below are
// the whole policy, because a rollback that fires on the wrong evidence is worse
// than no rollback at all — it would move a working install because someone's
// balance ran out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The marker path is resolved at import time, so the home has to exist first.
const HOME = mkdtempSync(join(tmpdir(), 'stability-'));
process.env.DSH_TG_HOME = HOME;
process.env.DSH_HOME = HOME;
const {
  FAULT_LIMIT, ROLLBACK_COOLDOWN_MS, applyRollback, isCodeFault, noteOutcome, noteTurn, recordFailure, releaseFacts, releasesOf,
  startupRollback,
} = await import('../stability.mjs');

const fresh = () => ({ sessions: {} });

test('a version that answers a turn is proven, and becomes the rollback target', () => {
  const state = fresh();
  const outcome = noteOutcome(state, { version: '1.30.0', error: '' });
  assert.equal(outcome.verdict, 'proven');
  assert.equal(outcome.rollback, '');
  assert.equal(releasesOf(state).lastGood, '1.30.0');
  assert.equal(releasesOf(state).proven['1.30.0'].turns, 1);
  // A second turn counts, it does not replace.
  noteOutcome(state, { version: '1.30.0', error: '' });
  assert.equal(releasesOf(state).proven['1.30.0'].turns, 2);
});

test('one code fault on an unproven version is not yet a verdict', () => {
  const state = fresh();
  noteOutcome(state, { version: '1.29.0', error: '' });
  noteOutcome(state, { version: '1.30.0', error: '' });
  // Clear the proof: this version has never answered.
  delete releasesOf(state).proven['1.30.0'];
  const first = noteOutcome(state, { version: '1.30.0', error: "ReferenceError: attempt is not defined" });
  assert.equal(first.verdict, 'fault');
  assert.equal(first.faults, 1);
  assert.equal(first.rollback, '', 'one fault is a fluke, not a release');
});

test('a version that never answered and keeps faulting is rolled back', () => {
  const state = fresh();
  noteOutcome(state, { version: '1.29.0', error: '' });
  const faults = [];
  for (let i = 0; i < FAULT_LIMIT + 2; i += 1) {
    faults.push(noteOutcome(state, { version: '1.30.0', error: 'ReferenceError: attempt is not defined' }).rollback);
  }
  // The decision is taken once, at the limit, and not repeated for the turns the
  // broken process keeps serving before it exits.
  assert.deepEqual(faults.filter(Boolean), ['1.29.0']);
  assert.equal(releasesOf(state).lastGood, '1.29.0');
});

test('the rollback target is the last version that answered', () => {
  const state = fresh();
  noteOutcome(state, { version: '1.28.1', error: '' });
  noteOutcome(state, { version: '1.29.0', error: '' });
  noteOutcome(state, { version: '1.30.0', error: 'ReferenceError: attempt is not defined' });
  const second = noteOutcome(state, { version: '1.30.0', error: 'ReferenceError: attempt is not defined' });
  assert.equal(second.rollback, '1.29.0', 'must go back to the newest proven one, not the oldest');
});

test('a provider error is never a verdict on the code', () => {
  const state = fresh();
  noteOutcome(state, { version: '1.29.0', error: '' });
  for (const error of [
    'AUTH 402 insufficient_user_quota',
    'fetch failed',
    'RATE_LIMIT 429',
    'all providers are busy',
    'turn exceeded 20 min',
  ]) {
    const outcome = noteOutcome(state, { version: '1.30.0', error });
    assert.equal(outcome.verdict, 'neutral', `${error} must not be blamed on the release`);
    assert.equal(outcome.rollback, '');
  }
  assert.equal(releasesOf(state).faults['1.30.0'], undefined);
});

test('a proven version is never rolled back, however many turns fail later', () => {
  const state = fresh();
  noteOutcome(state, { version: '1.29.0', error: '' });
  noteOutcome(state, { version: '1.30.0', error: '' });
  for (let i = 0; i < 10; i += 1) {
    assert.equal(noteOutcome(state, { version: '1.30.0', error: 'ReferenceError: x is not defined' }).rollback, '');
  }
  // One answered turn later, the fault marks are gone entirely.
  noteOutcome(state, { version: '1.30.0', error: '' });
  assert.equal(releasesOf(state).faults['1.30.0'], undefined);
});

test('a rollback is not repeated for turns that started before it', () => {
  const state = fresh();
  noteOutcome(state, { version: '1.29.0', error: '' });
  noteOutcome(state, { version: '1.30.0', error: 'x is not defined' });
  const first = noteOutcome(state, { version: '1.30.0', error: 'x is not defined' });
  assert.equal(first.rollback, '1.29.0');
  releasesOf(state).rolledBackAt = Date.now();
  const next = noteOutcome(state, { version: '1.30.0', error: 'x is not defined' });
  assert.equal(next.rollback, '', 'the process is still the broken one until it exits');
  // After the cooldown it may act again — the process can outlive ten minutes.
  releasesOf(state).rolledBackAt = Date.now() - ROLLBACK_COOLDOWN_MS - 1;
  assert.equal(noteOutcome(state, { version: '1.30.0', error: 'x is not defined' }).rollback, '1.29.0');
});

test('the code-fault list is narrow on purpose', () => {
  for (const text of [
    'ReferenceError: attempt is not defined',
    'TypeError: x is not a function',
    "Cannot read properties of undefined (reading 'id')",
    "SyntaxError: Unexpected token '}'",
    "The requested module './control/models.mjs' does not provide an export named 'profileOf'",
    "Cannot find module './turn-events.mjs'",
  ]) assert.equal(isCodeFault(text), true, text);
  for (const text of ['', 'HTTP 402', 'fetch failed', 'timeout after 30000ms', 'all providers are busy']) {
    assert.equal(isCodeFault(text), false, text);
  }
});

test('releaseFacts answers what /update needs without inventing anything', () => {
  const state = fresh();
  const empty = releaseFacts(state, '1.30.0');
  assert.equal(empty.verdict, 'unknown');
  assert.equal(empty.canRollBack, false);
  assert.equal(empty.lastGood, '');
  noteOutcome(state, { version: '1.29.0', error: '' });
  const behind = releaseFacts(state, '1.30.0');
  assert.equal(behind.canRollBack, true);
  assert.equal(behind.lastGood, '1.29.0');
  const current = releaseFacts(state, '1.29.0');
  assert.equal(current.canRollBack, false, 'rolling back to the version you are on is not a rollback');
});

test('the last failure is kept for /report, with the version it happened on', () => {
  const state = fresh();
  recordFailure(state, '1:2', { error: 'boom', model: 'm', tools: ['read'], cwd: '/x', seconds: 4, version: '1.30.0' });
  assert.equal(state.lastFailure['1:2'].version, '1.30.0');
  assert.deepEqual(state.lastFailure['1:2'].tools, ['read']);
});

test('a rollback installs the proven version and asks for a restart', async () => {
  rmSync(join(HOME, 'restart.pending'), { force: true });
  const state = fresh();
  noteOutcome(state, { version: '1.29.0', error: '' });
  const calls = [];
  const sent = [];
  const result = await applyRollback(state, {
    version: '1.29.0',
    lang: 'ru',
    t: (_lang, key, vars) => `${key}:${JSON.stringify(vars || {})}`,
    log: () => {},
    chatId: 42,
    threadId: 7,
    send: async (id, text, thread) => sent.push({ id, text, thread }),
    install: (version) => {
      calls.push(version);
      return { rolledBack: false, problems: [] };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.via, 'npm');
  assert.deepEqual(calls, ['1.29.0']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].id, 42);
  assert.equal(sent[0].thread, 7);
  assert.match(sent[0].text, /rel\.rolledBack/);
  // The restart is requested, never performed: the supervisor starts the restored
  // files when the queue is empty, so this turn still answers.
  assert.equal(existsSync(join(HOME, 'restart.pending')), true);
  assert.equal(JSON.parse(readFileSync(join(HOME, 'restart.pending'), 'utf8')).to, '1.29.0');
  assert.equal(releasesOf(state).history.length, 1);
});

test('a registry that cannot be reached falls back to the saved copy', async () => {
  const state = fresh();
  const restored = [];
  const result = await applyRollback(state, {
    version: '1.29.0',
    lang: 'en',
    t: (_lang, key) => key,
    log: () => {},
    install: () => {
      throw new Error('npm exited 1');
    },
    backup: () => join(HOME, 'update-backup-2026'),
    restore: (dir) => restored.push(dir),
  });
  assert.equal(result.ok, true);
  assert.equal(result.via, 'backup', 'the offline path is the saved copy, not a third invention');
  assert.deepEqual(restored, [join(HOME, 'update-backup-2026')]);
  assert.equal(result.problems.length, 1, 'the npm failure is still reported');
});

test('a rollback that fails says so and leaves the files alone', async () => {
  rmSync(join(HOME, 'restart.pending'), { force: true });
  const state = fresh();
  const sent = [];
  const result = await applyRollback(state, {
    version: '1.29.0',
    lang: 'en',
    t: (_lang, key) => key,
    log: () => {},
    chatId: 5,
    send: async (_id, text) => sent.push(text),
    install: () => ({ rolledBack: true, problems: ['bridge.mjs: syntax error'] }),
  });
  assert.equal(result.ok, false);
  assert.match(sent[0], /rel\.rollbackFailed/);
  assert.equal(existsSync(join(HOME, 'restart.pending')), false, 'no restart for a rollback that did not happen');
});

test('noteTurn never throws, whatever the state looks like', async () => {
  // A broken record must not cost the person the answer that is about to be sent.
  const state = fresh();
  const outcome = await noteTurn(state, {
    version: '1.30.0',
    error: '',
    saveState: () => {
      throw new Error('disk full');
    },
    log: () => {},
  });
  assert.equal(outcome.verdict, 'proven', 'the verdict survives a failed save');
});

test('a fault is recorded against the version that threw, not the one on disk', async () => {
  const state = fresh();
  await noteTurn(state, {
    version: '1.30.0',
    error: 'ReferenceError: attempt is not defined',
    saveState: () => {},
    log: () => {},
  });
  assert.equal(releasesOf(state).faults['1.30.0'], 1);
  assert.equal(releasesOf(state).faults['1.29.0'], undefined);
});

// ---------------------------------------------------------------- startup path
//
// A release that throws while it LOADS never reaches a turn, so nothing above
// can see it. The supervisor tick is the only witness, and these are the rules it
// follows — kept here, next to the turn rules, so the two cannot drift apart.

test('the supervisor leaves a version alone until it has failed to start twice', () => {
  const state = fresh();
  noteOutcome(state, { version: '1.29.0', error: '' });
  noteOutcome(state, { version: '1.30.0', error: 'ReferenceError: attempt is not defined' });
  assert.equal(startupRollback(state, '1.30.0'), '', 'one recorded fault is not a crash loop');
  assert.equal(startupRollback(state, '1.30.0', { crashLoop: true }), '1.29.0');
});

test('two recorded faults are enough without a crash loop', () => {
  const state = fresh();
  noteOutcome(state, { version: '1.29.0', error: '' });
  for (let i = 0; i < FAULT_LIMIT; i += 1) noteOutcome(state, { version: '1.30.0', error: 'x is not defined' });
  assert.equal(startupRollback(state, '1.30.0'), '1.29.0');
});

test('a crash loop with nothing proven to return to is not a rollback', () => {
  const state = fresh();
  assert.equal(startupRollback(state, '1.30.0', { crashLoop: true }), '', 'a fresh install has nowhere to go');
  noteOutcome(state, { version: '1.30.0', error: '' });
  assert.equal(startupRollback(state, '1.30.0', { crashLoop: true }), '', 'the version on disk already answered');
});

test('a version that answered once is never rolled back by a bad start', () => {
  const state = fresh();
  noteOutcome(state, { version: '1.29.0', error: '' });
  noteOutcome(state, { version: '1.30.0', error: '' });
  noteOutcome(state, { version: '1.30.0', error: 'x is not defined' });
  assert.equal(startupRollback(state, '1.30.0', { crashLoop: true }), '');
});

test('the supervisor does not repeat a rollback it just performed', () => {
  const state = fresh();
  noteOutcome(state, { version: '1.29.0', error: '' });
  noteOutcome(state, { version: '1.30.0', error: 'x is not defined' });
  noteOutcome(state, { version: '1.30.0', error: 'x is not defined' });
  const first = startupRollback(state, '1.30.0', { crashLoop: true });
  assert.equal(first, '1.29.0');
  // The tick records the rollback; the next tick, seconds later, must start the
  // restored files instead of restoring them again.
  releasesOf(state).startupRolledBackAt = Date.now();
  assert.equal(startupRollback(state, '1.30.0', { crashLoop: true }), '');
  releasesOf(state).startupRolledBackAt = Date.now() - ROLLBACK_COOLDOWN_MS - 1;
  assert.equal(startupRollback(state, '1.30.0', { crashLoop: true }), '1.29.0');
});

test('the supervisor never rolls back to the version it is already on', () => {
  const state = fresh();
  noteOutcome(state, { version: '1.29.0', error: '' });
  assert.equal(startupRollback(state, '1.29.0', { crashLoop: true }), '');
  assert.equal(startupRollback(state, '', { crashLoop: true }), '');
});
