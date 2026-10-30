import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSubagentRows, parseModelSelection, parseSubagentFleet, parseAgentPresets, parsePermissionPresets, parseReasoningEfforts } from '../profile/agents.mjs';

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
      provider: local-provider
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
  assert.equal(spawn.modelProvider, 'local-provider');
  assert.equal(spawn.reasoningEffort, 'high');
  assert.equal(spawn.maxDepth, 2);
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
          - provider: local-provider
            model: deepseek-v4.1-flash
          - provider: local-provider
            model: gemini-3.8-flash
`);
  assert.deepEqual(selection, {
    enabled: true,
    allowed: [
      { provider: 'local-provider', model: 'deepseek-v4.1-flash' },
      { provider: 'local-provider', model: 'gemini-3.8-flash' },
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
  assert.equal(fleet.plan, null);
  assert.deepEqual(parseSubagentFleet({}), { children: [], policy: null, plan: null });
});

test('the plan row folds to a boolean state, never to the plan text', () => {
  const fleet = parseSubagentFleet({ rows: { plan: { val: { active: true, pending: false } } } });
  assert.deepEqual(fleet.plan, { active: true, pending: false });
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

test('efforts come from the route catalog, not from a hard-coded list', () => {
  const text = `- id: llm-pi-ai
  name: provider
  config:
    models:
      - id: alpha
        contextWindow: 1000
        reasoningEfforts:
          off: null
          low: low
          high: high
      - id: beta
        contextWindow: 1000
`;
  assert.deepEqual(parseReasoningEfforts(text, 'alpha'), ['off', 'low', 'high']);
  assert.deepEqual(parseReasoningEfforts(text, 'beta'), []);
  assert.deepEqual(parseReasoningEfforts(text, 'missing'), []);
  // A model id with regex metacharacters must not widen the match.
  assert.deepEqual(parseReasoningEfforts(text, 'al.ha'), []);
});

test('the permission table reads its presets and the starting one', () => {
  const text = `- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: never
      workspace-write:
        name: "Sandboxed"
        sandbox: workspace-write
        approval: never
    defaultPreset: read-only
`;
  const table = parsePermissionPresets(text);
  assert.equal(table.current, 'read-only');
  assert.deepEqual(table.presets.map((row) => row.id), ['read-only', 'workspace-write']);
  assert.equal(table.presets[1].name, 'Sandboxed');
  assert.equal(table.presets[1].sandbox, 'workspace-write');
  assert.equal(parsePermissionPresets('- id: x\n  name: y\n'), null);
});

test('agent presets carry the row id and the registry default', () => {
  const text = `- id: preset-standard
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: standard
    order: 1
- id: preset-ptc
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: ptc
    order: 2
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    selectedDefault: ptc
`;
  const { presets, selected } = parseAgentPresets(text);
  assert.deepEqual(presets.map((row) => row.id), ['standard', 'ptc']);
  assert.equal(presets[0].row, 'preset-standard');
  assert.equal(selected, 'ptc');
  assert.deepEqual(parseAgentPresets(''), { presets: [], selected: '' });
});

test('a preset reads its own config, not the config of its last plugin', () => {
  // The desktop preset row is a whole composition: its `config:` is followed by
  // dozens of nested `config:` blocks. Reading the last one yields an empty id.
  const text = `- id: preset-standard
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: standard
    order: 1
    plugins:
      - id: persona
        name: '@deepseek-ai/dsh-persona'
        config:
          prefix: You are a coding agent.
      - id: tool-fs
        name: '@deepseek-ai/dsh-tool-fs'
        config:
          readOnly: false
`;
  const { presets } = parseAgentPresets(text);
  assert.deepEqual(presets, [{ row: 'preset-standard', id: 'standard', order: 1 }]);
});
