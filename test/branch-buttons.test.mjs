// The 🌿 picker: branch buttons on the rewind card. The contract under test:
// a button names a TURN (not steps), the plan is rebuilt from the live file at
// press time, and the actions type `/fork` and `/branch new` — the commands
// stay the only implementations of a branch.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { answerBranchPress, isBranchPress } from '../work/branch-buttons.mjs';
import { branchTarget } from '../work/rewind.mjs';
import { renderRewindUsage } from '../work/rewind-card.mjs';
import { writeSession } from './rewind-fixture.mjs';

const T = (key, vars = {}) => `${key}${Object.keys(vars).length ? `:${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')}` : ''}`;
const tailOf = (id) => id.slice(-8);

test('branchTarget: new takes an optional turn count', () => {
  assert.deepEqual(branchTarget('new'), { kind: 'topic', id: '', steps: 0 });
  assert.deepEqual(branchTarget('new 5'), { kind: 'topic', id: '', steps: 5 });
  assert.deepEqual(branchTarget('TOPIC 3'), { kind: 'topic', id: '', steps: 3 });
  assert.deepEqual(branchTarget('new x'), { kind: 'usage', id: '' });
  assert.deepEqual(branchTarget('session-abcdef12'), { kind: 'here', id: 'session-abcdef12' });
});

test('the rewind usage card offers 🌿 buttons with turn numbers', () => {
  const { file } = writeSession([{ user: 'a', answer: 'b' }, { user: 'c', answer: 'd' }, { user: 'e', answer: 'f' }]);
  const sessionId = 'session-0000abcd';
  const card = renderRewindUsage({ t: T, file, sessionId });
  const picks = card.keyboard[1];
  assert.equal(card.keyboard.length, 2);
  // recentTurns is newest first: the picker offers turns 3, 2, 1.
  assert.deepEqual(picks.map((b) => b.callback_data), [
    `bf:k:3:${tailOf(sessionId)}`,
    `bf:k:2:${tailOf(sessionId)}`,
    `bf:k:1:${tailOf(sessionId)}`,
  ]);
  assert.ok(picks.every((b) => b.text.startsWith('🌿')));
});

test('a pick redraws into a confirm card with honest numbers', () => {
  const { file } = writeSession([{ user: 'a', answer: 'b' }, { user: 'c', answer: 'd' }, { user: 'e', answer: 'f' }]);
  const sessionId = 'session-0000abcd';
  const done = answerBranchPress(`bf:k:2:${tailOf(sessionId)}`, {
    t: T,
    ctx: { sessionId, file, busy: false },
  });
  assert.ok(done.card);
  assert.equal(done.card.text, 'ctrl.branch.confirm:turn=2,kept=2');
  const [actions, cancel] = done.card.keyboard;
  assert.deepEqual(actions.map((b) => b.callback_data), [
    `bf:h:2:${tailOf(sessionId)}`,
    `bf:n:2:${tailOf(sessionId)}`,
  ]);
  assert.equal(cancel[0].callback_data, `bf:x:2:${tailOf(sessionId)}`);
});

test('confirm buttons type the commands, with steps counted from the live total', () => {
  const { file } = writeSession([{ user: 'a', answer: 'b' }, { user: 'c', answer: 'd' }, { user: 'e', answer: 'f' }]);
  const sessionId = 'session-0000abcd';
  const here = answerBranchPress(`bf:h:2:${tailOf(sessionId)}`, { t: T, ctx: { sessionId, file, busy: false } });
  assert.deepEqual(here, { command: '/fork 1' });
  const away = answerBranchPress(`bf:n:2:${tailOf(sessionId)}`, { t: T, ctx: { sessionId, file, busy: false } });
  assert.deepEqual(away, { command: '/branch new 1' });
  // The latest turn of a 3-turn session branches from the end: steps 0.
  const latest = answerBranchPress(`bf:h:3:${tailOf(sessionId)}`, { t: T, ctx: { sessionId, file, busy: false } });
  assert.deepEqual(latest, { command: '/fork 0' });
});

test('a stale or busy press changes nothing and says why', () => {
  const { file } = writeSession([{ user: 'a', answer: 'b' }, { user: 'c', answer: 'd' }]);
  const sessionId = 'session-0000abcd';
  // Another session: the suffix no longer matches.
  assert.deepEqual(answerBranchPress(`bf:k:1:${tailOf(sessionId)}`, {
    t: T, ctx: { sessionId: 'session-ffff8888', file, busy: false },
  }), { line: 'ctrl.rewind.stale' });
  // A turn beyond the live total: the session was rewound after the card.
  assert.deepEqual(answerBranchPress(`bf:k:9:${tailOf(sessionId)}`, {
    t: T, ctx: { sessionId, file, busy: false },
  }), { line: 'ctrl.rewind.stale' });
  // A running turn refuses: the file is the one thing this must not copy.
  assert.deepEqual(answerBranchPress(`bf:k:1:${tailOf(sessionId)}`, {
    t: T, ctx: { sessionId, file, busy: true },
  }), { line: 'ctrl.rewind.busy' });
  // Cancel is a no-op with one line.
  assert.deepEqual(answerBranchPress(`bf:x:1:${tailOf(sessionId)}`, {
    t: T, ctx: { sessionId, file, busy: false },
  }), { line: 'ctrl.rewind.cancelled' });
  assert.ok(isBranchPress('bf:k:1:0000abcd'));
  assert.ok(!isBranchPress('rw:y:1:0000abcd'));
});
