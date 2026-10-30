// The patch editor writes into a file that decides how every turn runs, so the
// tests check the two things that can go wrong silently: a value landing on the
// wrong key, and a round trip that changes lines nobody asked about.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { parseSubagentRows } from '../profile/agents.mjs';
import { setRowConfig, unsetRowConfig } from '../profile/profile-edit.mjs';

const PATCH = `# A profile patch with the shapes the bridge edits.
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: some-provider
    model: some-model
- id: tool-subagent
  name: "@deepseek-ai/dsh-tool-subagent"
  config:
    provider: spawn
    toolName: subagent
    agentOptions:
      provider: some-provider
      model: some-model
- id: tool-subagent-fork
  name: "@deepseek-ai/dsh-tool-subagent"
  config:
    provider: fork
    toolName: subagent_fork
    agentOptions:
      provider: some-provider
      model: other-model
`;

test('replaces a scalar that is already there', () => {
  const out = setRowConfig(PATCH, {
    pkg: '@deepseek-ai/dsh-agent-default-model',
    path: ['model'],
    value: 'next-model',
  });
  assert.ok(out);
  assert.match(out, /^ {4}model: next-model$/m);
  // Everything else comes back byte for byte, other rows included.
  assert.equal(out.replace('    model: next-model', '    model: some-model'), PATCH);
});

test('creates a missing nested key under an existing block', () => {
  const out = setRowConfig(PATCH, {
    pkg: '@deepseek-ai/dsh-tool-subagent',
    path: ['agentOptions', 'reasoningEffort'],
    value: 'high',
    match: (row) => row.text.includes('toolName: subagent\n'),
  });
  assert.ok(out);
  const rows = parseSubagentRows(out);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].reasoningEffort, 'high');
  assert.equal(rows[1].reasoningEffort, '');
  assert.equal(rows[0].model, 'some-model');
});

test('creates the config block when the row has none', () => {
  const text = `- id: effort\n  name: "@deepseek-ai/dsh-agent-default-model"\n`;
  const out = setRowConfig(text, {
    pkg: '@deepseek-ai/dsh-agent-default-model',
    path: ['reasoningEffort'],
    value: 'low',
  });
  assert.ok(out);
  assert.match(out, /^ {2}config:\n {4}reasoningEffort: low$/m);
});

test('writes a list as a block and keeps it parseable', () => {
  const out = setRowConfig(PATCH, {
    pkg: '@deepseek-ai/dsh-tool-subagent',
    path: ['toolFilter', 'deny'],
    value: ['workflow', 'subagent'],
    match: (row) => row.text.includes('toolName: subagent\n'),
  });
  assert.ok(out);
  assert.match(out, /^ {4}toolFilter:\n {6}deny:\n {8}- workflow\n {8}- subagent$/m);
});

test('only the matched row changes', () => {
  const nested = setRowConfig(PATCH, {
    pkg: '@deepseek-ai/dsh-tool-subagent',
    path: ['agentOptions', 'model'],
    value: 'fork-model',
    match: (row) => row.text.includes('toolName: subagent_fork'),
  });
  assert.ok(nested);
  const rows = parseSubagentRows(nested);
  assert.equal(rows[1].model, 'fork-model');
  assert.equal(rows[0].model, 'some-model');
  // The spawn row keeps its exact bytes.
  assert.ok(nested.includes('    toolName: subagent\n    agentOptions:\n      provider: some-provider\n      model: some-model\n'));
});

test('an unchanged value reports no change', () => {
  const out = setRowConfig(PATCH, {
    pkg: '@deepseek-ai/dsh-agent-default-model',
    path: ['model'],
    value: 'some-model',
  });
  assert.equal(out, null);
});

test('a package that is not in the patch reports no change', () => {
  const out = setRowConfig(PATCH, {
    pkg: '@deepseek-ai/dsh-permission-presets',
    path: ['defaultPreset'],
    value: 'read-only',
  });
  assert.equal(out, null);
});

test('unset removes the key with the lines under it', () => {
  const withExtras = setRowConfig(PATCH, {
    pkg: '@deepseek-ai/dsh-tool-subagent',
    path: ['toolFilter', 'deny'],
    value: ['workflow'],
    match: (row) => row.text.includes('toolName: subagent\n'),
  });
  const out = unsetRowConfig(withExtras, {
    pkg: '@deepseek-ai/dsh-tool-subagent',
    path: ['toolFilter'],
    match: (row) => row.text.includes('toolName: subagent\n'),
  });
  assert.ok(out);
  assert.equal(out, withExtras.replace(/ {4}toolFilter:\n {6}deny:\n {8}- workflow\n/, ''));
  assert.equal(unsetRowConfig(out, {
    pkg: '@deepseek-ai/dsh-tool-subagent',
    path: ['toolFilter'],
    match: (row) => row.text.includes('toolName: subagent\n'),
  }), null);
});

test('CRLF patches keep their line endings', () => {
  const crlf = PATCH.replace(/\n/g, '\r\n');
  const out = setRowConfig(crlf, {
    pkg: '@deepseek-ai/dsh-agent-default-model',
    path: ['model'],
    value: 'next-model',
  });
  assert.ok(out);
  assert.equal(out.split('\r\n').length, crlf.split('\r\n').length);
  assert.ok(!/[^\r]\n/.test(out));
});

test('the live headless profile round-trips through a subagent edit', () => {
  const path = join(homedir(), '.dsh', 'profiles', 'headless', 'cordis.patch.yml');
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return; // A machine without that profile still runs the rest of the suite.
  }
  const before = parseSubagentRows(text);
  assert.ok(before.length >= 1);
  const out = setRowConfig(text, {
    pkg: '@deepseek-ai/dsh-tool-subagent',
    path: ['maxDepth'],
    value: 2,
  });
  assert.ok(out);
  const after = parseSubagentRows(out);
  assert.equal(after[0].maxDepth, 2);
  assert.equal(after[0].model, before[0].model);
  assert.equal(after[0].toolName, before[0].toolName);
  // Only one line was added.
  assert.equal(out.split('\n').length, text.split('\n').length + 1);
});
