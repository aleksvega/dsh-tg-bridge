// Plan mode: the switch, the card, and the two presses under it.
//
// The feature is a promise about what a turn will not do, so the tests are about
// the promise keeping its word: the turn is asked for a plan and told not to act,
// Approve runs the request only while it is still current, and a tap on an old
// card runs nothing at all. The card's honest sentence — sandbox or model — is
// asserted from both sides, because a card that overstates the guarantee is worse
// than no card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-plan-'));
process.env.DSH_HOME = HOME;
mkdirSync(join(HOME, 'profiles', 'headless'), { recursive: true });
mkdirSync(join(HOME, 'profiles', 'strict'), { recursive: true });
const PATCH = (profile) => join(HOME, 'profiles', profile, 'cordis.patch.yml');

const { handlePlanCommands } = await import('../control/cmd-plan.mjs');
const { handlePlanPress } = await import('../chat/plan-press.mjs');
const { planCard, planOf, planPrelude, planPrompt, sandboxEnforces } = await import('../control/plan-mode.mjs');
const { state, config } = await import('../core/state.mjs');

const KEY = '42:336703';
const OTHER = '42:336704';

const reset = () => {
  delete state.planMode;
  state.profiles = {};
  config.profile = 'headless';
  config.allowedUserIds = [42];
};

/** A context shaped like the one `handleControl` builds. */
const ctx = (arg) => ({
  effective: '/plan',
  arg,
  lang: 'en',
  key: KEY,
  profile: 'headless',
  state,
  saveState: () => {},
  reply: async (text) => { ctx.said.push(text); },
});
ctx.said = [];

test('a bare /plan turns the mode on for that topic and says so', async () => {
  reset();
  ctx.said = [];
  assert.equal(await handlePlanCommands(ctx('')), true);
  assert.equal(ctx.said.length, 1);
  assert.match(ctx.said[0], /Plan mode is on for this topic/);
  assert.ok(planOf(state, KEY), 'the topic is in plan mode');
  assert.equal(planOf(state, OTHER), null, 'a neighbouring topic is untouched');
});

test('a second /plan turns it off and drops the card with it', async () => {
  reset();
  ctx.said = [];
  await handlePlanCommands(ctx(''));
  const id = planOf(state, KEY).id;
  await handlePlanCommands(ctx(''));
  assert.equal(planOf(state, KEY), null);
  assert.match(ctx.said.at(-1), /Plan mode is off for this topic/);
  // The id cannot be used to run anything once the switch is off.
  const said = [];
  let ran = 0;
  await handlePlanPress({
    data: `pm:ok:${id}`, key: KEY, lang: 'en', chatId: 1, threadId: 0,
    answer: async (x) => said.push(x), clearKeyboard: async () => {},
    redeliver: async () => { ran += 1; }, log: () => {},
  });
  assert.equal(ran, 0, 'a stale card executes nothing');
  assert.match(said[0], /stale/);
});

test('/plan on and /plan off are the same switch, said out loud', async () => {
  reset();
  ctx.said = [];
  await handlePlanCommands(ctx('on'));
  assert.ok(planOf(state, KEY));
  await handlePlanCommands(ctx('on'));
  assert.ok(planOf(state, KEY), 'on twice is still on, not a toggle back');
  await handlePlanCommands(ctx('off'));
  assert.equal(planOf(state, KEY), null);
});

test('the card calls the guarantee the model\'s when the preset is not read-only', async () => {
  reset();
  writeFileSync(PATCH('headless'), '- insert:\n    - id: sandbox-policy\n      config:\n        preset: workspace-write\n', 'utf8');
  assert.equal(sandboxEnforces(KEY), false);
  const card = planCard('en', KEY, 'p1');
  assert.match(card.text, /model's promise/);
  assert.doesNotMatch(card.text, /the machine itself/);
});

test('the card calls the guarantee the sandbox\'s on a read-only preset', async () => {
  reset();
  state.profiles = { [KEY]: 'strict' };
  writeFileSync(PATCH('strict'), [
    '- id: permission',
    '  name: "@deepseek-ai/dsh-permission-presets"',
    '  config:',
    '    presets:',
    '      read-only:',
    '        sandbox: read-only',
    '        approval: never',
    '    defaultPreset: read-only',
    '',
  ].join('\n'), 'utf8');
  assert.equal(sandboxEnforces(KEY), true);
  assert.match(planCard('en', KEY, 'p1').text, /the machine itself/);
});

test('Approve clears the flag and replays the person\'s own words', async () => {
  reset();
  writeFileSync(PATCH('headless'), '', 'utf8');
  ctx.said = [];
  await handlePlanCommands(ctx('on'));
  state.planMode[KEY].request = 'rename the file and run the tests';
  const id = state.planMode[KEY].id;

  const sent = [];
  let replayed = null;
  const ok = await handlePlanPress({
    data: `pm:ok:${id}`, key: KEY, lang: 'en', chatId: 42, threadId: 336703,
    answer: async (x) => sent.push(x), clearKeyboard: async () => {},
    redeliver: async (key, message) => { replayed = { key, message }; }, log: () => {},
  });
  assert.equal(ok, true);
  assert.equal(planOf(state, KEY), null, 'plan mode is off before the replay runs');
  assert.equal(replayed.key, KEY);
  assert.equal(replayed.message.text, 'rename the file and run the tests');
  assert.equal(replayed.message.message_thread_id, 336703);
  assert.match(sent[0], /Approved/);
});

test('Keep planning stays in plan mode and asks for a revision', async () => {
  reset();
  writeFileSync(PATCH('headless'), '', 'utf8');
  ctx.said = [];
  await handlePlanCommands(ctx('on'));
  state.planMode[KEY].request = 'add a flag to the parser';
  const id = state.planMode[KEY].id;

  let replayed = null;
  await handlePlanPress({
    data: `pm:more:${id}`, key: KEY, lang: 'en', chatId: 42, threadId: 0,
    answer: async () => {}, clearKeyboard: async () => {},
    redeliver: async (key, message) => { replayed = message; }, log: () => {},
  });
  assert.ok(planOf(state, KEY), 'the mode is still on');
  assert.match(replayed.text, /Revise the plan/);
});

test('a press on the previous card executes nothing', async () => {
  reset();
  writeFileSync(PATCH('headless'), '', 'utf8');
  ctx.said = [];
  await handlePlanCommands(ctx('on'));
  const old = state.planMode[KEY].id;
  state.planMode[KEY].request = 'something';
  state.planMode[KEY].id = 'p-new';

  let ran = 0;
  const said = [];
  await handlePlanPress({
    data: `pm:ok:${old}`, key: KEY, lang: 'en', chatId: 1, threadId: 0,
    answer: async (x) => said.push(x), clearKeyboard: async () => {},
    redeliver: async () => { ran += 1; }, log: () => {},
  });
  assert.equal(ran, 0);
  assert.match(said[0], /stale/i);
});

test('the plan prompt forbids a write in all three languages', () => {
  for (const lang of ['ru', 'en', 'zh']) {
    const text = planPrompt(lang);
    assert.ok(text.length > 60, `${lang} has a plan prompt`);
    // No raw key leaked: the prompt is prose, not `prompt.planMode`.
    assert.doesNotMatch(text, /^prompt\./);
  }
  assert.match(planPrompt('ru'), /не меняй ничего/);
  assert.match(planPrompt('zh'), /不要改动任何东西/);
});

test('the plan card has no raw key and two buttons per language', () => {
  for (const lang of ['ru', 'en', 'zh']) {
    const card = planCard(lang, KEY, 'p9');
    assert.doesNotMatch(card.text, /ctrl\.planmode\./);
    assert.equal(card.keyboard[0].length, 2);
    for (const button of card.keyboard[0]) {
      assert.ok(button.text.length > 0 && button.text.length <= 40, `${lang} label fits`);
      assert.doesNotMatch(button.text, /ctrl\./);
      assert.match(button.data, /^pm:(ok|more):p9$/);
    }
  }
});

test('the turn carries the no-write instruction only while the mode is on', async () => {
  reset();
  writeFileSync(PATCH('headless'), '', 'utf8');
  ctx.said = [];
  const request = 'rename the file and run the tests';
  const build = () => planPrelude({ state, key: KEY, lang: 'en', preface: 'goal block', text: request });

  await handlePlanCommands(ctx('on'));
  const planned = build();
  assert.match(planned, /PLAN MODE is on/);
  assert.match(planned, /do not edit files/);
  assert.ok(planned.includes(request), 'the person\'s own words still reach the turn');
  assert.ok(planned.startsWith('goal block'), 'the goal block comes first');

  // Approve clears the flag, so the replayed turn is the same words with no
  // no-write instruction: the one difference that lets it act.
  state.planMode[KEY].request = request;
  let replayed = null;
  await handlePlanPress({
    data: `pm:ok:${state.planMode[KEY].id}`, key: KEY, lang: 'en', chatId: 42, threadId: 336703,
    answer: async () => {}, clearKeyboard: async () => {},
    redeliver: async (key, message) => { replayed = message; }, log: () => {},
  });
  const after = build();
  assert.doesNotMatch(after, /PLAN MODE is on|do not edit files/);
  assert.equal(replayed.text, request);
});

test('a press that is not the plan card is not claimed', async () => {
  reset();
  const claimed = await handlePlanPress({
    data: 'mc:list', key: KEY, lang: 'en', chatId: 1, threadId: 0,
    answer: async () => {}, clearKeyboard: async () => {}, redeliver: async () => {}, log: () => {},
  });
  assert.equal(claimed, false);
});
