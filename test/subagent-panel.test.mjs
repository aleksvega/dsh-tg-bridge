// The panel's subagent rows.
//
// The headless stream has no event type for a subagent — no who, no tokens, no
// live progress — so a subagent arrives as an ordinary tool call and, later, its
// result. These tests hold the two things the chat can honestly show: which task
// ran, and how long the gap between call and result was. They deliberately do not
// pretend to test the edit cadence: that debounce lives inside a closure that
// needs a live Telegram client, and a test that stubs the client would be testing
// the stub.
import assert from 'node:assert/strict';
import test from 'node:test';

import { addStep, isSubagentTool, subagentStep } from '../chat/panel.mjs';

test('a subagent is recognised by its tool name, and a plain tool is not', () => {
  assert.equal(isSubagentTool('subagent'), true);
  assert.equal(isSubagentTool('subagent_fork'), true);
  assert.equal(isSubagentTool('read'), false);
  assert.equal(isSubagentTool(undefined), false);
});

test('one row per subagent, carrying the task it was given', () => {
  const first = subagentStep({ tool: 'subagent', input: { description: 'read the changelog' } }, 4000);
  const second = subagentStep({ tool: 'subagent_fork', input: { description: 'count the tests' } }, 9000);
  assert.equal(first, 'subagent: read the changelog · 4s');
  assert.equal(second, 'subagent_fork: count the tests · 9s');
  assert.notEqual(first, second, 'two subagents must not collapse into one row');
});

test('a duration that never came is absent, not a zero', () => {
  const line = subagentStep({ tool: 'subagent', input: { description: 'lost' } }, null);
  assert.equal(line, 'subagent: lost');
  assert.doesNotMatch(line, /·/, 'no result means no clock, not 0s');
  assert.equal(subagentStep({ tool: 'subagent', input: { description: 'neg' } }, -1), 'subagent: neg');
});

test('a sub-second gap still reads as at least one second', () => {
  assert.equal(subagentStep({ tool: 'subagent', input: { description: 'quick' } }, 120), 'subagent: quick · 1s');
});

test('the task is one line: whitespace collapsed and the tail cut', () => {
  const line = subagentStep({ tool: 'subagent', input: { description: `look\n\t  at   this ${'x'.repeat(80)}` } }, 2000);
  const label = line.slice('subagent: '.length, -' · 2s'.length);
  assert.equal(label.includes('\n'), false, 'a newline would break the row');
  assert.equal(label.includes('  '), false, 'runs of spaces are collapsed');
  assert.ok(label.length <= 52, `label was ${label.length} characters`);
});

test('a subagent with no description falls back to the prompt, then to the name', () => {
  assert.equal(subagentStep({ tool: 'subagent', input: { prompt: 'investigate' } }, 1000), 'subagent: investigate · 1s');
  assert.equal(subagentStep({ tool: 'subagent', input: {} }, 1000), 'subagent · 1s');
  assert.equal(subagentStep({ input: {} }, null), 'subagent');
});

test('an identical subagent row folds into the one above it', () => {
  const steps = [];
  addStep(steps, subagentStep({ tool: 'subagent', input: { description: 'same task' } }, 1000));
  addStep(steps, subagentStep({ tool: 'subagent', input: { description: 'same task' } }, 1000));
  addStep(steps, subagentStep({ tool: 'subagent', input: { description: 'same task' } }, 1000));
  assert.deepEqual(steps, ['subagent: same task · 1s ×3']);
});

test('the same task with a different duration stays a second row', () => {
  // Folding compares the rendered line, not the task: two runs of one task that
  // took four and nine seconds are two facts, and collapsing them would hide one.
  const steps = [];
  addStep(steps, subagentStep({ tool: 'subagent', input: { description: 'same task' } }, 4000));
  addStep(steps, subagentStep({ tool: 'subagent', input: { description: 'same task' } }, 9000));
  assert.deepEqual(steps, ['subagent: same task · 4s', 'subagent: same task · 9s']);
});