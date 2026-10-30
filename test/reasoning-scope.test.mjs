// One setting, two scopes.
//
// The reasoning trail is the most personal switch on the surface: one topic is
// worth watching line by line, and every other topic should stay quiet. So the
// setting has a default and a per-topic override, and the question this file
// answers is which of the two `/reasoning` just changed — the failure being
// guarded against is "I turned it off everywhere and this topic still talks".
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-reasoning-'));

const { reasoningMode } = await import('../notes.mjs');

const context = ({ state, config, lang = 'en', key = '1:7' }) => {
  const said = [];
  return {
    said,
    ctx: {
      effective: '/reasoning',
      command: '/reasoning',
      arg: '',
      lang,
      key,
      profile: 'headless',
      state,
      config,
      activeTurns: new Map(),
      send: async (text) => said.push(text),
      reply: async (text) => said.push(text),
      log: () => {},
      saveState: () => {},
      saveConfig: () => {},
    },
  };
};

const run = async (arg, { state, config, lang = 'en', key = '1:7' }) => {
  const { handleViewCommands } = await import('../control/cmd-views.mjs');
  const { ctx, said } = context({ state, config, lang, key });
  await handleViewCommands({ ...ctx, arg });
  return said.join('\n');
};

const fresh = () => ({ state: { reasoning: {}, sessions: {}, cwd: {}, goals: {} }, config: { profile: 'headless', lang: 'en' } });

test('a topic with no opinion follows the default, and the default starts at the card', () => {
  const { state, config } = fresh();
  assert.equal(reasoningMode(state, config, '1:9'), 'card');
  config.reasoning = 'off';
  assert.equal(reasoningMode(state, config, '1:9'), 'off', 'an untouched topic does not follow the default');
});

test('without `all` the change is this topic only', async () => {
  const env = fresh();
  await run('chat', env);
  assert.equal(env.state.reasoning['1:7'], 'chat');
  assert.equal(env.config.reasoning, undefined, 'a plain switch wrote the global default');
  assert.equal(reasoningMode(env.state, env.config, '1:9'), 'card');
});

test('with `all` the change is the default every other topic reads', async () => {
  const env = fresh();
  await run('off all', env);
  assert.equal(env.config.reasoning, 'off');
  assert.equal(reasoningMode(env.state, env.config, '1:9'), 'off');
  // The topic that gave the order is not special-cased: it is still untouched,
  // so it reads the same default and the two never disagree.
  assert.equal(reasoningMode(env.state, env.config, '1:7'), 'off');
});

test('a topic keeps its own choice when the default moves, and the answer says so', async () => {
  const env = fresh();
  await run('chat', env);
  const said = await run('off all', env);
  assert.equal(reasoningMode(env.state, env.config, '1:7'), 'chat', 'the global switch overrode a topic');
  assert.equal(reasoningMode(env.state, env.config, '1:9'), 'off');
  // Saying "every topic" while one of them does something else would be a lie
  // the person only discovers later, so the card warns in the same breath.
  assert.match(said, /set for every topic/i);
});

test('a bare /reasoning names both scopes, so the question "which am I looking at" is answered', async () => {
  const env = fresh();
  await run('chat', env);
  await run('off all', env);
  for (const lang of ['en', 'ru', 'zh']) {
    const said = await run('', { ...env, lang });
    assert.doesNotMatch(said, /msg\.reasoning/, `${lang} leaked a key`);
    assert.match(said, /\/reasoning .*all/, `${lang} does not teach the global form`);
  }
  // The two numbers in the sentence are two different facts.
  const said = await run('', env);
  assert.match(said, /in the chat and in the progress message/i);
  assert.match(said, /Everywhere else: off/i);
});

test('`global` is accepted as the same word as `all`', async () => {
  const env = fresh();
  await run('card global', env);
  assert.equal(env.config.reasoning, 'card');
});

test('a word that is not a mode changes nothing and still answers', async () => {
  const env = fresh();
  const before = JSON.stringify(env.state.reasoning);
  const said = await run('banana', env);
  assert.equal(JSON.stringify(env.state.reasoning), before);
  assert.ok(said.length > 0, 'an unknown word answered with silence');
});