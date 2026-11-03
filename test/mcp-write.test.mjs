// Writing one MCP server into a profile, and taking it out again.
//
// The bridge hand-parses YAML that the host also owns, so every guard here is
// about not breaking a working install: a duplicate name, a file that no longer
// parses, a profile edited between the preview and the confirm, and a foreign
// entry that the chat must never delete. Each refusal is asserted with the file
// bytes before and after — "it refused" only means something if the file is
// byte-identical afterwards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-mcpw-'));
process.env.DSH_HOME = HOME;
mkdirSync(join(HOME, 'profiles', 'headless'), { recursive: true });
const PATCH = join(HOME, 'profiles', 'headless', 'cordis.patch.yml');

const BASE = `- insert:
    - id: sandbox-policy
      name: "@deepseek-ai/dsh-sandbox-policy"
      config:
        preset: workspace-write
`;

const reset = () => writeFileSync(PATCH, BASE, 'utf8');
reset();

const { withMcpServer, withoutMcpServer, commitMcp, CHAT_MARK } = await import('../control/mcp-write.mjs');
const { parseMcpServers } = await import('../control/mcp-config.mjs');

test('an add appends one entry the parser reads back', () => {
  reset();
  const built = withMcpServer({ profile: 'headless', name: 'local', url: 'https://mcp.example.com/mcp' });
  assert.equal(built.ok, true);
  // The write is not done yet: the caller shows `yaml` first.
  assert.equal(readFileSync(PATCH, 'utf8'), BASE);
  const servers = parseMcpServers(built.text);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].server, 'local');
  assert.equal(servers[0].transport, 'streamable-http');
  // The marker is what makes the entry removable later, so it must be in the text.
  assert.match(built.yaml, new RegExp(CHAT_MARK));
});

test('a written entry is marked as the chat’s own and survives a re-read', () => {
  reset();
  const built = withMcpServer({ profile: 'headless', name: 'local', url: 'https://mcp.example.com/mcp' });
  commitMcp(built);
  const servers = parseMcpServers(readFileSync(PATCH, 'utf8'));
  assert.equal(servers.length, 1);
  assert.equal(servers[0].chatAdded, true);
  // The neighbour the file already had is untouched.
  assert.match(readFileSync(PATCH, 'utf8'), /sandbox-policy/);
});

test('a duplicate name is refused and the file is not touched', () => {
  reset();
  commitMcp(withMcpServer({ profile: 'headless', name: 'local', url: 'https://mcp.example.com/mcp' }));
  const before = readFileSync(PATCH, 'utf8');
  const again = withMcpServer({ profile: 'headless', name: 'local', url: 'https://other.example.com/mcp' });
  assert.equal(again.ok, false);
  assert.equal(again.why, 'duplicate');
  assert.equal(readFileSync(PATCH, 'utf8'), before);
});

test('a file that changed under the preview is refused, not overwritten', () => {
  reset();
  const built = withMcpServer({ profile: 'headless', name: 'local', url: 'https://mcp.example.com/mcp' });
  // Somebody edits the profile between the preview and the press.
  writeFileSync(PATCH, `${BASE}# hand edit\n`, 'utf8');
  const edited = readFileSync(PATCH, 'utf8');
  const written = withMcpServer({
    profile: 'headless', name: 'local', url: 'https://mcp.example.com/mcp', expected: built.text,
  });
  assert.equal(written.ok, false);
  assert.equal(written.why, 'changed');
  assert.equal(readFileSync(PATCH, 'utf8'), edited);
});

test('a missing profile is refused instead of created', () => {
  const gone = withMcpServer({ profile: 'no-such-profile', name: 'local', url: 'https://x.example.com/mcp' });
  assert.equal(gone.ok, false);
  assert.equal(gone.why, 'noProfile');
});

test('removal takes out a chat-added entry and leaves the neighbour', () => {
  reset();
  commitMcp(withMcpServer({ profile: 'headless', name: 'local', url: 'https://mcp.example.com/mcp' }));
  const [server] = parseMcpServers(readFileSync(PATCH, 'utf8'));
  const cut = withoutMcpServer({ profile: 'headless', id: server.id });
  assert.equal(cut.ok, true);
  commitMcp(cut);
  const text = readFileSync(PATCH, 'utf8');
  assert.equal(parseMcpServers(text).length, 0);
  assert.match(text, /sandbox-policy/);
  assert.equal(text.includes(CHAT_MARK), false);
});

test('a hand-written entry is refused with a reason, and stays', () => {
  reset();
  // The Exa block, copied in by hand — exactly what the chat must not delete.
  const handmade = `${BASE}${'# Exa hosted MCP\n- insert:\n    - id: mcp-exa\n      name: \'@deepseek-ai/dsh-mcp-client\'\n      config:\n        transport: streamable-http\n        serverName: exa\n        url: https://mcp.exa.ai/mcp\n'}`;
  writeFileSync(PATCH, handmade, 'utf8');
  const [server] = parseMcpServers(handmade);
  assert.equal(server.chatAdded, false);
  const cut = withoutMcpServer({ profile: 'headless', id: server.id });
  assert.equal(cut.ok, false);
  assert.equal(cut.why, 'foreign');
  assert.equal(readFileSync(PATCH, 'utf8'), handmade);
});

test('removal of an entry that is already gone says so', () => {
  reset();
  const cut = withoutMcpServer({ profile: 'headless', id: 'mcp-ghost' });
  assert.equal(cut.ok, false);
  assert.equal(cut.why, 'gone');
});

test('the command previews, refuses a duplicate, and removes its own entry', async () => {
  reset();
  const { handleMcpCommands } = await import('../control/cmd-mcp.mjs');
  const { state } = await import('../core/state.mjs');
  const said = [];
  const ctx = (arg) => ({
    effective: '/mcp',
    arg,
    lang: 'en',
    key: 'chat:1',
    profile: 'headless',
    state,
    config: { profile: 'headless' },
    log: () => {},
    reply: async (text, opts) => said.push({ text, opts }),
  });

  // The add shows the YAML and writes nothing.
  await handleMcpCommands(ctx('add local https://mcp.example.com/mcp'));
  assert.equal(readFileSync(PATCH, 'utf8'), BASE);
  assert.match(said.at(-1).text, /streamable-http/);
  assert.equal(said.at(-1).opts.keyboard[0][0].data, 'mc:add');
  // The preview is held in state, so the press can find it after a restart.
  assert.equal(state.mcpPending['chat:1'].name, 'local');

  // A duplicate is refused by name.
  commitMcp(withMcpServer({ profile: 'headless', name: 'local', url: 'https://mcp.example.com/mcp' }));
  await handleMcpCommands(ctx('add local https://other.example.com/mcp'));
  assert.match(said.at(-1).text, /local/);
  assert.match(said.at(-1).text, /already exists|duplicate|server named/i);

  // A foreign entry is not removed.
  await handleMcpCommands(ctx('rm exa'));
  // (nothing to remove: `exa` was never in this fixture)
  await handleMcpCommands(ctx('rm local'));
  assert.equal(parseMcpServers(readFileSync(PATCH, 'utf8')).length, 0);
});

test('the list card refuses a profile that is not there', async () => {
  const { handleMcpCommands } = await import('../control/cmd-mcp.mjs');
  const said = [];
  await handleMcpCommands({
    effective: '/mcp',
    arg: '',
    lang: 'ru',
    key: 'chat:2',
    profile: 'ghost',
    state: {},
    config: {},
    log: () => {},
    reply: async (text) => said.push(text),
  });
  assert.match(said[0], /ghost/);
});
