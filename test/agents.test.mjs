import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSubagentRows, parseModelSelection, parseSubagentFleet } from '../agents.mjs';

const patch = `# a profile patch
- id: tool-subagent
  name: "@deepseek-ai/dsh-tool-subagent"
  config:
    provider: spawn
    toolName: subagent
    backgroundMode: continuable
    enableRunInBackground: true
    maxDepth: 2
    persona: |
      You are a reviewer. Check the diff, not the prose.
    toolFilter:
      deny:
        - workflow
        - subagent
    agentOptions:
      provider: unorouter
      model: deepseek-v4.1-flash
      reasoningEffort: high
- insert:
    - id: subagent-fork
      name: '@deepseek-ai/dsh-tool-subagent'
      config:
        provider: fork
        toolName: subagent_fork
`;

test('a subagent row carries the knobs the bridge reports', () => {
  const rows = parseSubagentRows(patch);
  assert.equal(rows.length, 2);
  const [spawn, fork] = rows;
  assert.equal(spawn.id, 'tool-subagent');
  assert.equal(spawn.toolName, 'subagent');
  assert.equal(spawn.provider, 'spawn');
  assert.equal(spawn.model, 'deepseek-v4.1-flash');
  assert.equal(spawn.modelProvider, 'unorouter');
  assert.equal(spawn.reasoningEffort, 'high');
  assert.equal(spawn.maxDepth, '2');
  assert.equal(spawn.backgroundMode, 'continuable');
  assert.equal(spawn.persona, true);
  assert.equal(spawn.toolDeny, 2);
  assert.equal(fork.id, 'subagent-fork');
  assert.equal(fork.model, '');
  assert.equal(fork.persona, false);
});

test('a patch with no delegation row reports no agents', () => {
  assert.deepEqual(parseSubagentRows('- id: agent-default-model\n  name: x\n'), []);
});

test('model selection lists every route a child may pick', () => {
  const selection = parseModelSelection(`- insert:
    - id: subagent-model-selection-settings
      name: "@deepseek-ai/dsh-tool-subagent/model-selection-settings"
      config:
        enabled: true
        allowedModels:
          - provider: unorouter
            model: deepseek-v4.1-flash
          - provider: unorouter
            model: gemini-3.8-flash
`);
  assert.deepEqual(selection, {
    enabled: true,
    allowed: [
      { provider: 'unorouter', model: 'deepseek-v4.1-flash' },
      { provider: 'unorouter', model: 'gemini-3.8-flash' },
    ],
  });
  assert.equal(parseModelSelection('- id: x\n  name: y\n'), null);
});

test('the fleet reads the catalog the delegation tools publish', () => {
  const fleet = parseSubagentFleet({
    record: {
      rows: {
        subagentCatalog: {
          val: {
            head: {
              values: [
                { childId: 'session-a', label: 'Sweep the docs', mode: 'continuable', childCreatedAt: 100 },
                { childId: 'session-b', label: 'Later one', mode: 'one-shot', childCreatedAt: 300 },
                { nope: true },
              ],
            },
          },
        },
        subagentModelSelectionPolicy: { val: { allowed: [] } },
      },
    },
  });
  assert.deepEqual(fleet.children.map((row) => row.id), ['session-b', 'session-a']);
  assert.deepEqual(fleet.policy, { allowed: [] });
  assert.deepEqual(parseSubagentFleet({}), { children: [], policy: null });
});

test('the live desktop profile parses without throwing', () => {
  const home = process.env.DSH_HOME || `${process.env.USERPROFILE}\\.dsh`;
  let text = '';
  try {
    text = readFileSync(`${home}\\profiles\\desktop\\cordis.patch.yml`, 'utf8');
  } catch {
    return; // no desktop profile on this machine: nothing to assert
  }
  const rows = parseSubagentRows(text);
  assert.ok(rows.length >= 2, 'desktop ships a spawn and a fork delegation tool');
  assert.ok(rows.every((row) => row.toolName), 'every row names its tool');
});
