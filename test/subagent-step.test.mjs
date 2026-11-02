// A subagent is a whole turn running on the side, and the headless stream has no
// event type for one: it arrives as an ordinary tool call and a later result.
// These tests pin what the card can honestly say about it.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { isSubagentTool, subagentStep } from '../chat/panel.mjs';

test('only subagent tools are treated as subagents', () => {
  assert.equal(isSubagentTool('subagent'), true);
  assert.equal(isSubagentTool('subagent_fork'), true);
  assert.equal(isSubagentTool('pwsh'), false);
  assert.equal(isSubagentTool(''), false);
  assert.equal(isSubagentTool(undefined), false);
});

test('the call line names the task, not the tool arguments', () => {
  const line = subagentStep({ tool: 'subagent', input: { description: 'Проверить релиз', prompt: 'long brief '.repeat(20) } });
  assert.equal(line, 'subagent: Проверить релиз');
});

test('the result adds the measured duration, never a guess', () => {
  const call = { tool: 'subagent', input: { description: 'Проверить релиз' } };
  assert.equal(subagentStep(call, 0), 'subagent: Проверить релиз · 1s');
  assert.equal(subagentStep(call, 41_600), 'subagent: Проверить релиз · 42s');
  assert.equal(subagentStep(call), 'subagent: Проверить релиз');
});

test('a long or missing label still yields a usable line', () => {
  const long = subagentStep({ tool: 'subagent', input: { description: 'x'.repeat(200) } });
  assert.equal(long.length, 'subagent: '.length + 52);
  assert.equal(subagentStep({ tool: 'subagent' }), 'subagent');
  assert.equal(subagentStep({ tool: 'subagent', input: { description: '  a\n\nb  ' } }), 'subagent: a b');
});