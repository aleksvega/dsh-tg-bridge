// A press on an `/mcp` card.
//
// The router's job is to answer every press, and to re-read the profile instead
// of trusting the card it was drawn from. The cases below are the ones a person
// actually hits: a card from before a restart, a server deleted by hand since the
// card was drawn, a tool row that must copy rather than run, and the confirm that
// lands after somebody edited the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-mcpp-'));
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

const { handleMcpPress, listCard, serverCard } = await import('../chat/mcp-press.mjs');
const { withMcpServer, commitMcp, CHAT_MARK } = await import('../control/mcp-write.mjs');
const { parseMcpServers } = await import('../control/mcp-config.mjs');
const { state } = await import('../core/state.mjs');

/** A press context that records what was sent and redirects Telegram calls. */
function press(data, key = 'chat:1') {
  const sent = [];
  const ctx = {
    data,
    key,
    lang: 'en',
    chatId: 1,
    threadId: 336703,
    messageId: 5,
    answer: async (text) => sent.push({ answer: text }),
  };
  return { ctx, sent };
}

test('an empty profile lists nothing and offers the add command', () => {
  reset();
  const card = listCard('en', 'headless');
  assert.match(card.text, /no MCP servers/i);
  assert.deepEqual(card.keyboard, []);
});

test('a server card names the transport, the redacted address and the row', () => {
  writeFileSync(PATCH, `${BASE}${'- insert:\n    - id: mcp-secret\n      name: \'@deepseek-ai/dsh-mcp-client\'\n      config:\n        transport: streamable-http\n        serverName: secret\n        url: https://mcp.example.com/mcp?key=abc123\n'}`, 'utf8');
  const card = serverCard('en', 'headless', 'mcp-secret');
  assert.match(card.text, /streamable-http/);
  assert.match(card.text, /mcp\.example\.com/);
  // The token never reaches the card.
  assert.equal(card.text.includes('abc123'), false);
  assert.match(card.text, /key=\*+/);
});

test('a press on a server that has since been deleted says so', async () => {
  reset();
  const { ctx, sent } = press('mc:srv:mcp-ghost');
  assert.equal(await handleMcpPress(ctx), true);
  assert.match(sent.at(-1).answer, /no longer|gone/i);
});

test('a tool row copies the name and runs nothing', async () => {
  reset();
  const { ctx, sent } = press('mc:tool:web_search_exa');
  assert.equal(await handleMcpPress(ctx), true);
  assert.match(sent.at(-1).answer, /web_search_exa/);
  // Nothing was written: a copied name is not an action.
  assert.equal(readFileSync(PATCH, 'utf8'), BASE);
});

test('a confirm without a preview is stale, not an append', async () => {
  reset();
  delete state.mcpPending;
  const { ctx, sent } = press('mc:add', 'chat:none');
  assert.equal(await handleMcpPress(ctx), true);
  assert.match(sent.at(-1).answer, /stale/i);
  assert.equal(readFileSync(PATCH, 'utf8'), BASE);
});

test('cancel drops the pending add and writes nothing', async () => {
  reset();
  state.mcpPending = { 'chat:c': { name: 'local', url: 'https://mcp.example.com/mcp', text: BASE, from: BASE, at: Date.now() } };
  const { ctx, sent } = press('mc:cancel', 'chat:c');
  assert.equal(await handleMcpPress(ctx), true);
  assert.equal(state.mcpPending['chat:c'], undefined);
  assert.match(sent.at(-1).answer, /Nothing was written/i);
  assert.equal(readFileSync(PATCH, 'utf8'), BASE);
});

test('a confirm writes when the file still matches the preview', async () => {
  reset();
  const built = withMcpServer({ profile: 'headless', name: 'local', url: 'https://mcp.example.com/mcp' });
  state.mcpPending = { 'chat:ok': { name: 'local', url: 'https://mcp.example.com/mcp', text: built.text, from: built.from, at: Date.now() } };
  const { ctx, sent } = press('mc:add', 'chat:ok');
  assert.equal(await handleMcpPress(ctx), true);
  const text = readFileSync(PATCH, 'utf8');
  assert.equal(parseMcpServers(text).length, 1);
  assert.match(text, new RegExp(CHAT_MARK));
  // The answer promises a restart, and never calls the server running.
  assert.match(sent.at(-1).answer, /restart|restart confirm/i);
  assert.equal(/\brunning now\b|\bis running\b/i.test(sent.at(-1).answer), false);
});

test('a confirm after a hand edit is refused and the edit survives', async () => {
  reset();
  const built = withMcpServer({ profile: 'headless', name: 'local', url: 'https://mcp.example.com/mcp' });
  writeFileSync(PATCH, `${BASE}# hand edit\n`, 'utf8');
  const edited = readFileSync(PATCH, 'utf8');
  state.mcpPending = { 'chat:edit': { name: 'local', url: 'https://mcp.example.com/mcp', text: built.text, from: built.from, at: Date.now() } };
  const { ctx, sent } = press('mc:add', 'chat:edit');
  assert.equal(await handleMcpPress(ctx), true);
  assert.match(sent.at(-1).answer, /changed|nothing was written/i);
  assert.equal(readFileSync(PATCH, 'utf8'), edited);
});

test('an unknown press prefix is not claimed', async () => {
  const { ctx } = press('fs:0');
  assert.equal(await handleMcpPress(ctx), false);
});
