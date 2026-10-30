// Adding an endpoint from the chat, without a model in the loop.
//
// The command edits a profile file, and a profile file that is half-wrong does
// not fail loudly — it fails on the next turn, as "the bot stopped answering",
// with nothing pointing at the line that was typed. So most of these tests are
// about refusals: the shapes a person actually types (`sk-…` pasted where a
// variable name goes, `http://`, a space in the URL) and whether each one is
// stopped before it reaches the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-endpoint-'));
process.env.DSH_HOME = HOME;
mkdirSync(join(HOME, 'profiles', 'headless'), { recursive: true });
const PATCH = join(HOME, 'profiles', 'headless', 'cordis.patch.yml');

const BASE = `- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      unorouter:
        displayName: Unorouter
        apiKeyEnv: UNOROUTER_API_KEY
        api: openai-responses
        baseURL: https://api.unorouter.com/v1
        defaultContextWindow: 1000000
        models:
          - id: deepseek-v4.1-flash
            name: deepseek-v4.1-flash
            contextWindow: 1048576
      wikivibe:
        displayName: Wikivibe
        apiKeyEnv: WIKIVIBE_API_KEY
        api: openai-responses
        baseURL: https://api.wikivibe.dev/v1
        models:
          - id: deepseek-v4.1-flash
            name: deepseek-v4.1-flash
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: wikivibe
    model: deepseek-v4.1-flash
    reasoningEffort: max
- id: sandbox-policy
  name: "@deepseek-ai/dsh-sandbox-policy"
  config:
    preset: workspace-write
`;

const reset = () => writeFileSync(PATCH, BASE, 'utf8');
reset();

const { parseEndpointArgs, withEndpoint, endpointRows, checkBaseUrl, checkKeyEnv } = await import('../control/endpoint.mjs');
const { handleEndpointCommands } = await import('../control/cmd-endpoint.mjs');
const { routesOf } = await import('../control/models.mjs');

test('a URL has to be https, because the key travels on every request', () => {
  assert.equal(checkBaseUrl('https://api.example.com/v1').ok, true);
  assert.equal(checkBaseUrl('http://api.example.com/v1').why, 'insecure');
  // localhost is the exception that earns it: a model server on this machine
  // never crosses a network, so the key is not exposed by the scheme.
  assert.equal(checkBaseUrl('http://localhost:11434/v1').ok, true);
  assert.equal(checkBaseUrl('http://127.0.0.1:8000/v1').ok, true);
  assert.equal(checkBaseUrl('api.example.com/v1').why, 'notUrl');
  assert.equal(checkBaseUrl('').why, 'empty');
  // A trailing slash is dropped so joining a path never doubles it.
  assert.equal(checkBaseUrl('https://api.example.com/v1/').url, 'https://api.example.com/v1');
});

test('the key variable is a name, so a pasted key is refused rather than saved', () => {
  assert.equal(checkKeyEnv('MYROUTER_API_KEY').ok, true);
  const pasted = checkKeyEnv('sk-abc123secret');
  assert.equal(pasted.ok, false, 'a key that starts with sk- is not a variable name');
  assert.equal(checkKeyEnv('lowercase').ok, false);
  assert.equal(checkKeyEnv('').why, 'empty');
});

test('the forms a person actually types parse to what they meant', () => {
  assert.deepEqual(parseEndpointArgs('add myrouter https://api.myrouter.com/v1 MYROUTER_API_KEY'), {
    ok: true, verb: 'add', id: 'myrouter', baseURL: 'https://api.myrouter.com/v1', keyEnv: 'MYROUTER_API_KEY', models: [],
  });
  const withModels = parseEndpointArgs('add myrouter https://api.myrouter.com/v1 MYROUTER_API_KEY a,b');
  assert.deepEqual(withModels.models, ['a', 'b']);
  // An id typed in capitals is the same endpoint, not a second one.
  assert.equal(parseEndpointArgs('add MyRouter https://a.example/v1 KEY_X').id, 'myrouter');
  assert.equal(parseEndpointArgs('').why, 'usage');
  // Three words is a complaint about the shape; four words with a non-URL in the
  // URL slot is a complaint about the URL, which names the thing to fix.
  assert.equal(parseEndpointArgs('add only two').why, 'usage');
  assert.equal(parseEndpointArgs('add only two args').why, 'url.notUrl');
  // Models typed as separate words are one list, not a second argument.
  assert.deepEqual(parseEndpointArgs('add bad https://a.example/v1 KEY_X a b,c').models, ['a', 'b', 'c']);
});

test('a new endpoint is written where a reader would look for it, before the next entry', () => {
  const result = withEndpoint(BASE, parseEndpointArgs('add myrouter https://api.myrouter.com/v1 MYROUTER_API_KEY m1,m2'));
  assert.equal(result.ok, true);
  const lines = result.text.split('\n');
  const at = lines.findIndex((line) => /^\s+myrouter:$/.test(line));
  assert.ok(at > 0);
  // Inside the providers block: before `agent-default-model`, not after it.
  assert.ok(at < lines.findIndex((line) => line.startsWith('- id: agent-default-model')));
  assert.equal(lines[at + 1].trim(), 'displayName: myrouter');
  assert.match(result.text, /- id: m1\n\s+name: m1\n\s+- id: m2\n\s+name: m2/);
});

test('adding to an existing endpoint adds models and never reorders or drops the old ones', () => {
  const result = withEndpoint(BASE, parseEndpointArgs('add wikivibe https://api2.wikivibe.dev/v1 WIKIVIBE_API_KEY kimi-k3'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.modelsAdded, ['kimi-k3']);
  assert.match(result.text, /api2\.wikivibe\.dev/);
  // The original model is still there, with its keys intact and above the new one.
  const block = result.text.slice(result.text.indexOf('wikivibe:'), result.text.indexOf('- id: agent-default-model'));
  assert.match(block, /- id: deepseek-v4\.1-flash\n\s+name: deepseek-v4\.1-flash\n\s+- id: kimi-k3/);
});

test('re-typing what is already there is a no-op, not a rewrite', () => {
  const result = withEndpoint(BASE, parseEndpointArgs('add wikivibe https://api.wikivibe.dev/v1 WIKIVIBE_API_KEY'));
  assert.equal(result.ok, false);
  assert.equal(result.why, 'unchanged');
});

test('removing the last provider leaves the entries below it alone', () => {
  // The last block's end is where the provider list ends, not the end of the
  // file: reading it as the file's end would delete every plugin row under it.
  const result = withEndpoint(BASE, parseEndpointArgs('rm wikivibe'));
  assert.equal(result.ok, true);
  assert.doesNotMatch(result.text, /wikivibe:/);
  assert.match(result.text, /- id: agent-default-model/);
  assert.match(result.text, /- id: sandbox-policy/);
  // And the first provider is untouched.
  assert.match(result.text, /unorouter:/);
});

test('the list reads the patch, not a second copy of it', () => {
  const rows = endpointRows('headless');
  assert.deepEqual(rows.map((row) => row.id), ['unorouter', 'wikivibe']);
  assert.deepEqual(rows[0].models, ['deepseek-v4.1-flash']);
  assert.equal(rows[0].baseURL, 'https://api.unorouter.com/v1');
  assert.equal(rows[0].keyEnv, 'UNOROUTER_API_KEY');
});

const run = async (arg, lang = 'en') => {
  const said = [];
  const claimed = await handleEndpointCommands({
    effective: '/endpoint',
    arg,
    lang,
    profile: 'headless',
    config: { profile: 'headless' },
    reply: async (text) => said.push(text),
    log: () => {},
  });
  return { claimed, said: said.join('\n') };
};

test('the command keeps every command that is not its own', async () => {
  const other = await handleEndpointCommands({
    effective: '/model', arg: '', lang: 'en', profile: 'headless', config: {}, reply: async () => {}, log: () => {},
  });
  assert.equal(other, false);
});

test('an added endpoint is immediately a route on the /model card', async () => {
  reset();
  const before = routesOf('headless').length;
  const { said } = await run('add myrouter https://api.myrouter.com/v1 MYROUTER_API_KEY fresh-1,fresh-2', 'en');
  assert.match(said, /Endpoint myrouter added/);
  assert.match(said, /fresh-1, fresh-2/);
  // The promise the message makes is the promise the picker keeps.
  assert.match(said, /\/model draws 2 route\(s\)/);
  assert.equal(routesOf('headless').length, before + 2);
});

test('a pasted key never reaches the profile file', async () => {
  reset();
  const secret = 'sk-very-secret-value-123';
  const { said } = await run(`add leaked ${secret} https://api.x.example/v1`, 'en');
  assert.equal(readFileSync(PATCH, 'utf8'), BASE, 'the file changed after a refused line');
  assert.doesNotMatch(readFileSync(PATCH, 'utf8'), /very-secret/);
  assert.ok(said.length > 0);
});

test('every refusal says something, and none of them prints a key name', async () => {
  reset();
  for (const arg of ['add x', 'add x http://api.x.dev/v1 KEY_X', 'add x api.x.dev KEY_X', 'rm', 'nonsense']) {
    const { claimed, said } = await run(arg, 'en');
    assert.equal(claimed, true, `${arg} was not claimed`);
    assert.ok(said.length > 0, `${arg} refused silently`);
    assert.doesNotMatch(said, /ctrl\.endpoint\./, `${arg} printed a raw key`);
  }
  assert.equal(readFileSync(PATCH, 'utf8'), BASE, 'a refused line changed the file');
});

test('three languages answer in their own words', async () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const { said } = await run('list', lang);
    assert.doesNotMatch(said, /ctrl\.endpoint\./, `${lang} leaked a key`);
    assert.match(said, /unorouter/, `${lang} list does not name the endpoints`);
  }
});

test('a profile with no providers block is left alone', async () => {
  const dir = join(HOME, 'profiles', 'bare');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cordis.patch.yml'), '- id: something\n  disabled: true\n', 'utf8');
  const result = withEndpoint('- id: something\n  disabled: true\n', parseEndpointArgs('add x https://a.example/v1 KEY_X'));
  assert.equal(result.ok, false);
  assert.equal(result.why, 'noProviders');
  assert.equal(readFileSync(join(dir, 'cordis.patch.yml'), 'utf8'), '- id: something\n  disabled: true\n');
});