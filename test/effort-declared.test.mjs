// A reasoning level the model does not declare kills a turn before its first
// token, and "repeat the request" is the one piece of advice that cannot work:
// the same profile fails the same way. Measured on grok-4.7, where the profile
// asked for `max` while the model declared a list ending at `high`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { explainFailure } from '../turn/failures.mjs';
import { dropEffortFromText, parseReasoningEfforts, parseReasoningEffortsFor } from '../profile/agents.mjs';
import { effortThatWouldDrop } from '../control/models.mjs';

const raw = 'dsh: UNSUPPORTED_REASONING_EFFORT: provider "unorouter" '
  + 'model "grok-4.7" does not support reasoning effort "max"';

test('an unsupported reasoning level names the setting, not the account', () => {
  for (const lang of ['ru', 'en', 'zh']) {
    const said = explainFailure(raw, lang);
    assert.match(said, /EFFORT_UNSUPPORTED/, `${lang}: reported as an unknown failure`);
    assert.match(said, /\/effort/, `${lang}: the fix is not named`);
    assert.doesNotMatch(said, /TURN_FAILED/, `${lang}: the generic line shadowed the cause`);
  }
});

test('the advice is about the level, never "repeat the request"', () => {
  const said = explainFailure(raw, 'ru');
  assert.doesNotMatch(said, /повтори запрос/i, 'a repeat would fail identically');
  assert.match(said, /уровень/i);
});

test('a quota failure is still a quota failure', () => {
  // The new rule must not swallow the money case: both arrive as a provider
  // error, and the one the person can act on has to win.
  assert.match(explainFailure('402 insufficient_user_quota', 'ru'), /INSUFFICIENT_QUOTA/);
  assert.match(explainFailure('AUTH 403 invalid api key', 'ru'), /INVALID_KEY/);
});

// A model id is not unique in a profile: `deepseek-v4.1-flash` is declared by two
// providers in the same file, and one of them leaves `minimal` out. Searching the
// whole file by name returns whichever entry comes first, so a guard built on that
// answer keeps a level the route refuses — the exact failure it exists to prevent.
const TWO_PROVIDERS = [
  '- id: llm-pi-ai',
  '  config:',
  '    providers:',
  '      unorouter:',
  '        models:',
  '          - id: deepseek-v4.1-flash',
  '            reasoningEfforts:',
  '              off: null',
  '              minimal: minimal',
  '              low: low',
  '              high: high',
  '              max: max',
  '      wikivibe:',
  '        models:',
  '          - id: deepseek-v4.1-flash',
  '            reasoningEfforts:',
  '              off: null',
  '              low: low',
  '              high: high',
  '              max: max',
  '          - id: glm-5.3',
  '            reasoningEfforts:',
  '              low: low',
  '',
].join('\n');

test('a level belongs to the provider that declares it, not to the name', () => {
  const route = { provider: 'wikivibe', model: 'deepseek-v4.1-flash' };
  assert.deepEqual(
    parseReasoningEffortsFor(TWO_PROVIDERS, { provider: 'unorouter', model: 'deepseek-v4.1-flash' }),
    ['off', 'minimal', 'low', 'high', 'max'],
  );
  assert.deepEqual(parseReasoningEffortsFor(TWO_PROVIDERS, route), ['off', 'low', 'high', 'max']);
  // The old lookup is the one that cannot tell them apart — kept as the reason the
  // provider-scoped call exists.
  assert.ok(parseReasoningEfforts(TWO_PROVIDERS, 'deepseek-v4.1-flash').includes('minimal'));
  // A provider the file does not name falls back to the name, so an overlay that
  // only carries the route row still answers.
  assert.deepEqual(parseReasoningEffortsFor(TWO_PROVIDERS, { provider: 'nope', model: 'glm-5.3' }), ['low']);
  assert.deepEqual(parseReasoningEffortsFor(TWO_PROVIDERS, { model: 'glm-5.3' }), ['low']);
});

test('the guard reads the provider the route names', () => {
  // `minimal` survives the switch under unorouter and must not survive it under
  // wikivibe: the host would refuse the turn on the first one that is wrong.
  const text = `${TWO_PROVIDERS}- id: agent-default-model\n  provider: wikivibe\n`
    + '  model: deepseek-v4.1-flash\n  reasoningEffort: minimal\n';
  assert.equal(effortThatWouldDrop(text, { provider: 'unorouter', model: 'deepseek-v4.1-flash' }), '');
  assert.equal(effortThatWouldDrop(text, { provider: 'wikivibe', model: 'deepseek-v4.1-flash' }), 'minimal');
});

// The model is the one the person chose; the level is what is wrong with the
// request. So the level goes and the route stays — the answer to this failure is
// never a switch, and the chain must not read it as one.
test('the level goes and the model stays', () => {
  const text = '- id: agent-default-model\n  provider: unorouter\n  model: grok-4.7\n'
    + '  reasoningEffort: max\n  temperature: 0.3\n';
  const { text: after, dropped } = dropEffortFromText(text);
  assert.equal(dropped, 'max');
  assert.doesNotMatch(after, /reasoningEffort/, 'the level is what the host refuses');
  assert.match(after, /model: grok-4\.7/, 'the model must survive the fix');
  assert.match(after, /temperature: 0\.3/, 'nothing else in the row may be touched');
  // A second pass has nothing to remove, and must not rewrite the file: a turn
  // that already runs without a level would otherwise write on every attempt.
  const again = dropEffortFromText(after);
  assert.equal(again.dropped, '');
  assert.equal(again.text, after);
  // A profile with no such row is left exactly as it was.
  const none = dropEffortFromText('- id: permissions\n  mode: full\n');
  assert.equal(none.dropped, '');
  assert.equal(none.text, '- id: permissions\n  mode: full\n');
});
