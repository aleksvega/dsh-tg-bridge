// Reading the MCP servers out of a profile, without a host.
//
// The card's whole claim is that it cannot disagree with what the host loads,
// because it reads the same file. That claim is only worth something if the parse
// is pinned to the real shape: `mcp-exa` in a `headless` profile, one
// `- insert:` block per plugin family, the MCP entry itself `{id, name, config}`.
// So the fixture below is that block, copied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-mcp-'));
process.env.DSH_HOME = HOME;
mkdirSync(join(HOME, 'profiles', 'headless'), { recursive: true });
const PATCH = join(HOME, 'profiles', 'headless', 'cordis.patch.yml');

// Verbatim from `profiles/headless/cordis.patch.yml`: the comment above the block,
// the `- insert:` wrapper, and the quoted package name.
const EXA = `- insert:
    - id: worktree
      name: "@deepseek-ai/dsh-experimental-worktree"
# Exa hosted MCP: web_search_exa / web_fetch_exa for unattended research.
- insert:
    - id: mcp-exa
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: streamable-http
        serverName: exa
        url: https://mcp.exa.ai/mcp
- insert:
    - id: sandbox-policy
      name: "@deepseek-ai/dsh-sandbox-policy"
      config:
        preset: workspace-write
`;

const { parseMcpServers, mcpServers, redactSecret, safeUrl, checkServerName } = await import('../control/mcp-config.mjs');

test('the real headless block parses into one server the person can name', () => {
  const servers = parseMcpServers(EXA);
  assert.equal(servers.length, 1);
  const [exa] = servers;
  assert.equal(exa.server, 'exa');
  assert.equal(exa.id, 'mcp-exa');
  assert.equal(exa.transport, 'streamable-http');
  assert.equal(exa.url, 'https://mcp.exa.ai/mcp');
  // An entry that was there before the chat ever touched the file is not the
  // chat's to remove, and the card says so from this flag.
  assert.equal(exa.chatAdded, false);
});

test('a profile with no MCP block answers nothing, not an error', () => {
  assert.deepEqual(parseMcpServers('- insert:\n    - id: sandbox-policy\n      name: "@deepseek-ai/dsh-sandbox-policy"\n'), []);
  assert.deepEqual(parseMcpServers(''), []);
});

test('two entries parse as two, each with its own transport', () => {
  const two = `${EXA}- insert:
    - id: mcp-local
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: stdio
        serverName: local
        command: node
        args:
          - server.js
`;
  const servers = parseMcpServers(two);
  assert.deepEqual(servers.map((one) => one.server), ['exa', 'local']);
  assert.equal(servers[1].transport, 'stdio');
  assert.equal(servers[1].command, 'node');
  assert.deepEqual(servers[1].args, ['server.js']);
});

test('a token in a query string is hidden, and the rest of the URL is not', () => {
  assert.equal(redactSecret('https://mcp.example.com/mcp?key=abc123&x=1'), 'https://mcp.example.com/mcp?key=***&x=***');
  assert.equal(safeUrl('https://mcp.example.com/mcp?key=abc123'), 'https://mcp.example.com/mcp?key=***');
  // The identifying parts survive: a host and a path are what tell two servers
  // apart, and hiding them would make the card useless.
  assert.match(safeUrl('https://mcp.example.com/mcp?token=zzz'), /^https:\/\/mcp\.example\.com\/mcp\?token=\*+$/);
  // A credential in the userinfo part has no `=` to anchor on, so it is caught
  // by parsing rather than by the pattern.
  assert.equal(safeUrl('https://user:pass@mcp.example.com/mcp'), 'https://***:***@mcp.example.com/mcp');
});

test('secrets are hidden in every view the parser produces', () => {
  const withToken = `- insert:
    - id: mcp-secret
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: streamable-http
        serverName: secret
        url: https://mcp.example.com/mcp?api_key=sk-live-123
`;
  const [server] = parseMcpServers(withToken);
  assert.equal(server.url.includes('sk-live-123'), false);
  assert.match(server.url, /api_key=\*+/);
});

test('a missing profile is one sentence, not an exception', () => {
  const found = mcpServers('nope-not-here');
  assert.equal(found.ok, false);
  assert.equal(found.why, 'missingProfile');
  assert.deepEqual(found.servers, []);
});

test('a profile that is there is read from disk', () => {
  writeFileSync(PATCH, EXA, 'utf8');
  const found = mcpServers('headless');
  assert.equal(found.ok, true);
  assert.deepEqual(found.servers.map((one) => one.server), ['exa']);
});

test('a server name is checked before it reaches a callback or a file', () => {
  assert.equal(checkServerName('exa').ok, true);
  assert.equal(checkServerName('my-server_2').ok, true);
  assert.equal(checkServerName('').why, 'empty');
  assert.equal(checkServerName('bad name').why, 'badName');
  assert.equal(checkServerName('9lives').why, 'badName');
  assert.equal(checkServerName('x'.repeat(60)).why, 'badName');
});
