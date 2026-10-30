// A model per topic, and a profile that is only the default.
//
// The person runs several chats for different kinds of work: one where they
// think out loud, one where an engineering problem is being solved. One model
// for the whole install means the choice that suits the second slows down the
// first — so the choice belongs to the topic, and the profile keeps the answer
// for the topics that never chose.
//
// What these tests hold down: the two scopes never overwrite each other, a
// topic's route becomes a profile the host can actually boot, and that profile
// is a copy — the row it rewrote is the only row it may touch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-topic-model-'));
process.env.DSH_HOME = HOME;

const PATCH = `- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      unorouter:
        baseURL: https://api.unorouter.com/v1
        models:
          - id: deepseek-v4.1-flash
            name: deepseek-v4.1-flash
          - id: glm-5.3:free
            name: glm-5.3:free
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: unorouter
    model: deepseek-v4.1-flash
    reasoningEffort: max
`;

mkdirSync(join(HOME, 'profiles', 'headless'), { recursive: true });
writeFileSync(join(HOME, 'profiles', 'headless', 'cordis.patch.yml'), PATCH, 'utf8');

const { modelOf } = await import('../control/models.mjs');
const { topicRoute, setTopicRoute, clearTopicRoute, routeExists, routeProfile } = await import('../control/topic-route.mjs');
const { handleModelCommand } = await import('../control/cmd-model.mjs');
const { t } = await import('../core/i18n.mjs');

const run = async (arg, { state = {}, config = { profile: 'headless', lang: 'en' }, key = '1:7', lang = 'en' } = {}) => {
  const said = [];
  await handleModelCommand({
    arg,
    say: (text) => said.push(text),
    log: () => {},
    state,
    key,
    config,
    lang,
    profile: config.profile,
    t,
    saveState: () => {},
  });
  return said.join('\n');
};

test('a topic with no route follows the profile, and says so', () => {
  const route = topicRoute({ state: {}, config: { profile: 'headless' }, key: '1:7' });
  assert.deepEqual(route, { provider: 'unorouter', model: 'deepseek-v4.1-flash', base: 'headless', source: 'profile' });
});

test('a route written for one topic is not read by another', () => {
  const state = {};
  setTopicRoute(state, '1:7', { provider: 'unorouter', model: 'glm-5.3:free' });
  assert.equal(topicRoute({ state, config: { profile: 'headless' }, key: '1:7' }).model, 'glm-5.3:free');
  assert.equal(topicRoute({ state, config: { profile: 'headless' }, key: '1:9' }).source, 'profile');
});

test('`/model <route>` moves this topic and leaves the file alone', async () => {
  const state = {};
  const said = await run('unorouter/glm-5.3:free', { state });
  assert.deepEqual(state.route['1:7'], { provider: 'unorouter', model: 'glm-5.3:free' });
  assert.deepEqual(modelOf('headless'), { provider: 'unorouter', model: 'deepseek-v4.1-flash' });
  // Both scopes in one answer: the topic moved, the profile did not.
  assert.match(said, /glm-5\.3:free/);
  assert.match(said, /deepseek-v4\.1-flash/, 'the default is named so the difference is visible');
});

test('`/model <route> all` moves the default, and the topic that chose keeps its own', async () => {
  const state = {};
  setTopicRoute(state, '1:7', { provider: 'unorouter', model: 'deepseek-v4.1-flash' });
  const said = await run('glm-5.3:free all', { state, key: '1:7' });
  assert.deepEqual(modelOf('headless'), { provider: 'unorouter', model: 'glm-5.3:free' });
  assert.equal(topicRoute({ state, config: { profile: 'headless' }, key: '1:7' }).model, 'deepseek-v4.1-flash');
  assert.equal(topicRoute({ state, config: { profile: 'headless' }, key: '1:9' }).model, 'glm-5.3:free');
  assert.match(said, /keep it/i, 'a default that does not reach every topic must say so');
});

test('`/model auto` hands the topic back to the profile', async () => {
  const state = {};
  setTopicRoute(state, '1:7', { provider: 'unorouter', model: 'glm-5.3:free' });
  await run('auto', { state });
  assert.deepEqual(state.route, {});
  assert.equal(topicRoute({ state, config: { profile: 'headless' }, key: '1:7' }).source, 'profile');
  // Clearing twice is not an error, and it does not pretend something changed.
  const again = await run('auto', { state });
  assert.match(again, /never|did not|no route/i);
});

test('a route the profile does not declare is refused in every language', async () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const state = {};
    const said = await run('unorouter/no-such-model', { state, lang });
    assert.deepEqual(state.route ?? {}, {}, `${lang} stored a route that cannot boot`);
    assert.doesNotMatch(said, /ctrl\.model\./, `${lang} leaked a key`);
    assert.match(said, /no-such-model/);
  }
});

test('a route profile is a copy with one row moved, not a rewrite of the profile', () => {
  // Earlier tests moved the default, so the file is put back: this test is about
  // what a copy contains, not about what the previous test left behind.
  writeFileSync(join(HOME, 'profiles', 'headless', 'cordis.patch.yml'), PATCH, 'utf8');
  const name = routeProfile('headless', { provider: 'unorouter', model: 'glm-5.3:free' });
  assert.ok(name, 'no profile was materialised');
  const copy = readFileSync(join(HOME, 'profiles', name, 'cordis.patch.yml'), 'utf8');
  assert.match(copy, /model: glm-5\.3:free/);
  // The keys the copy did not come for are still there: a switch that drops
  // `reasoningEffort` turns a model change into a behaviour change.
  assert.match(copy, /reasoningEffort: max/);
  // And the providers are the same list, or the turn cannot boot.
  assert.match(copy, /baseURL: https:\/\/api\.unorouter\.com\/v1/);
  assert.deepEqual(modelOf('headless'), { provider: 'unorouter', model: 'deepseek-v4.1-flash' });
});

test('the same route twice is the same profile, and the copy tracks the profile', () => {
  writeFileSync(join(HOME, 'profiles', 'headless', 'cordis.patch.yml'), PATCH, 'utf8');
  const first = routeProfile('headless', { provider: 'unorouter', model: 'glm-5.3:free' });
  const second = routeProfile('headless', { provider: 'unorouter', model: 'glm-5.3:free' });
  assert.equal(first, second, 'two names for one route would leave one of them stale');

  // The profile gains a provider later; the topic's copy has to see it, or the
  // topic is frozen at the moment it chose.
  writeFileSync(join(HOME, 'profiles', 'headless', 'cordis.patch.yml'), PATCH.replace(
    '- id: agent-default-model',
    `      late:
        baseURL: https://api.late.example/v1
        models:
          - id: late-model
            name: late-model
- id: agent-default-model`,
  ), 'utf8');
  const name = routeProfile('headless', { provider: 'unorouter', model: 'glm-5.3:free' });
  const copy = readFileSync(join(HOME, 'profiles', name, 'cordis.patch.yml'), 'utf8');
  assert.match(copy, /late-model/, 'the copy stopped tracking the profile it came from');
  assert.match(copy, /model: glm-5\.3:free/, 'and the topic still runs the model it chose');
});

test('a route for a profile that does not exist materialises nothing', () => {
  assert.equal(routeProfile('no-such-profile', { provider: 'unorouter', model: 'glm-5.3:free' }), '');
  assert.equal(routeProfile('headless', { provider: 'unorouter', model: '' }), '');
  assert.equal(existsSync(join(HOME, 'profiles', 'no-such-profile')), false);
});

test('routeExists checks the model and the provider it is offered on', () => {
  assert.equal(routeExists('headless', { provider: 'unorouter', model: 'glm-5.3:free' }), true);
  // The same model on a provider the profile does not declare is not a route.
  assert.equal(routeExists('headless', { provider: 'wikivibe', model: 'glm-5.3:free' }), false);
  assert.equal(routeExists('headless', { provider: '', model: 'glm-5.3:free' }), true);
  assert.equal(routeExists('headless', { provider: 'unorouter', model: '' }), false);
});

test('clearing a route that was never set is reported, not invented', () => {
  const state = {};
  assert.equal(clearTopicRoute(state, '1:7'), false);
  setTopicRoute(state, '1:7', { provider: 'unorouter', model: 'glm-5.3:free' });
  assert.equal(clearTopicRoute(state, '1:7'), true);
});
