// Who answered: the one fact the route card could not state.
//
// A topic is configured to one route. The failover chain can answer on another,
// and after that the card kept naming the route it configures — the honest
// answer, "this is not who replied", had nowhere to live. These tests pin both
// places a person looks for it.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const { renderSettingsCard, settingsCurrent } = await import('../settings-card.mjs');
const { modelCard } = await import('../control/model-card.mjs');
const { newTelemetry } = await import('../turn-events.mjs');
const { t } = await import('../i18n.mjs');

const words = (lang) => (key, vars) => t(lang, key, vars);
const base = {
  reasoning: 'card',
  reasoningAll: 'card',
  lang: 'auto',
  pin: 'off',
  answered: null,
};

test('the settings card names the model that answered, and the fallback', () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const tt = words(lang);
    const plain = renderSettingsCard({ page: 'agent', t: tt, current: base, updateMode: 'check' }).text;
    const wouldSay = tt('model.answered', { model: 'MODEL-X' });
    assert.ok(!plain.includes(wouldSay), `${lang}: nothing answered yet, so no answered line`);

    const answered = renderSettingsCard({
      page: 'agent',
      t: tt,
      current: { ...base, answered: { model: 'router-a/model-b', switched: true } },
      updateMode: 'check',
    }).text;
    assert.ok(answered.includes('router-a/model-b'), `${lang}: the card must name the model`);
    assert.ok(answered.includes(tt('model.answeredSwitched', { model: 'router-a/model-b' })),
      `${lang}: and say it was the chain`);
  }
});

test('the settings card keeps the answered line off the other pages', () => {
  const tt = words('ru');
  for (const page of ['reply', 'updates', 'health']) {
    const text = renderSettingsCard({
      page,
      t: tt,
      current: { ...base, answered: { model: 'router-a/model-b', switched: true } },
      updateMode: 'check',
    }).text;
    assert.ok(!text.includes('router-a/model-b'), `${page}: who answered belongs to the agent page`);
  }
});

test('settingsCurrent reads the answer from the state file, per topic', () => {
  const state = { answered: { '1:2': { model: 'p/m', switched: false } } };
  assert.equal(settingsCurrent({ config: {}, state, key: '1:2' }).answered.model, 'p/m');
  assert.equal(settingsCurrent({ config: {}, state, key: '3:4' }).answered, null);
  assert.equal(settingsCurrent({ config: {}, state: {}, key: '' }).answered, null);
});

test('the /model card says which route actually answered', () => {
  const tt = words('ru');
  const routes = [{ provider: 'p', model: 'm', current: true }];
  const plain = modelCard({ profile: 'headless', routes, current: { provider: 'p', model: 'm' }, t: tt }).text;
  assert.ok(!plain.includes(tt('ctrl.model.answered', { model: 'MODEL-X' })), 'nothing to say before a turn');

  const text = modelCard({
    profile: 'headless',
    routes,
    current: { provider: 'p', model: 'm' },
    answered: { model: 'router-a/model-b', switched: true },
    t: tt,
  }).text;
  assert.ok(text.includes('router-a/model-b'));
  assert.ok(text.includes(tt('ctrl.model.answeredSwitched', { model: 'router-a/model-b' })));
});

test('telemetry starts without a switch, and marks one when it happens', () => {
  assert.equal(newTelemetry('p/m').switched, false, 'a fresh turn has not switched anything');
  assert.equal(newTelemetry('p/m').model, 'p/m');
});
