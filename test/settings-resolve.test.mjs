import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSettings, profileValues, settingsChip, touchesProfile } from '../settings.mjs';

const profile = profileValues({
  model: { model: 'deepseek-v4.1-flash', provider: 'unorouter' },
  permissions: 'workspace-write',
  preset: 'default',
  effort: 'medium',
});

const declared = { models: ['deepseek-v4.1-flash', 'glm-5.3'], efforts: ['low', 'medium', 'high'], permissions: ['read-only', 'workspace-write'], presets: ['default', 'persona'] };

test('topic override beats set beats profile, and every source is reported', () => {
  const resolved = resolveSettings({
    set: { model: 'glm-5.3', effort: 'low', permissions: 'read-only' },
    override: { model: 'deepseek-v4.1-flash' },
    profile,
    ...declared,
  });
  assert.equal(resolved.model, 'deepseek-v4.1-flash');
  assert.equal(resolved.sources.model, 'topic');
  assert.equal(resolved.effort, 'low');
  assert.equal(resolved.sources.effort, 'set');
  assert.equal(resolved.permissions, 'read-only');
  assert.equal(resolved.sources.permissions, 'set');
  assert.equal(resolved.dshPreset, 'default');
  assert.equal(resolved.sources.dshPreset, 'profile');
});

test('an empty set inherits every field from the profile', () => {
  const resolved = resolveSettings({ set: { id: 'empty', model: '', effort: '', permissions: '' }, profile, ...declared });
  assert.equal(resolved.model, 'deepseek-v4.1-flash');
  assert.equal(resolved.effort, 'medium');
  assert.equal(resolved.sources.model, 'profile');
  assert.equal(resolved.sources.effort, 'profile');
});

test('no set and no override is the bare profile, and nothing touches the profile', () => {
  const resolved = resolveSettings({ profile, ...declared });
  assert.equal(resolved.model, 'deepseek-v4.1-flash');
  assert.equal(resolved.touchesProfile, false);
  assert.equal(settingsChip(resolved, { name: 'x' }), '');
});

test('a set naming an undeclared model is dropped, not fatal', () => {
  const resolved = resolveSettings({ set: { model: 'no-such-model', effort: 'high' }, profile, ...declared });
  assert.equal(resolved.model, 'deepseek-v4.1-flash');
  assert.equal(resolved.sources.model, 'set (invalid)');
  // the effort itself is still declared, so it survives the dropped model
  assert.equal(resolved.effort, 'high');
  assert.equal(resolved.sources.effort, 'set');

  const modelOnly = resolveSettings({ set: { model: 'no-such-model' }, profile, ...declared });
  assert.equal(modelOnly.effort, 'medium');
  assert.equal(modelOnly.sources.effort, 'profile');

  // a model with no declared efforts keeps whatever the turn had
  const withoutList = resolveSettings({ set: { model: 'no-such-model', effort: 'high' }, profile, models: declared.models, efforts: [], permissions: declared.permissions, presets: declared.presets });
  assert.equal(withoutList.effort, 'high');
});

test('an effort declared for the profile but not for the set model is dropped', () => {
  const resolved = resolveSettings({
    set: { model: 'glm-5.3', effort: 'xhigh' },
    profile,
    models: declared.models,
    efforts: ['low', 'high'],
    permissions: declared.permissions,
    presets: declared.presets,
    override: null,
  });
  assert.equal(resolved.model, 'glm-5.3');
  assert.equal(resolved.sources.model, 'set');
  assert.equal(resolved.effort, 'medium');
  assert.equal(resolved.sources.effort, 'set (invalid)');
});

test('a set whose base profile is gone falls back to the topic profile', () => {
  const resolved = resolveSettings({ set: { base: 'deleted-profile', model: '' }, profile, ...declared });
  assert.equal(resolved.model, 'deepseek-v4.1-flash');
  assert.equal(resolved.sources.model, 'profile');
});

test('the chip shows only what the set actually changes', () => {
  const picked = resolveSettings({ set: { model: 'glm-5.3', effort: 'high', permissions: 'read-only' }, profile, ...declared });
  assert.equal(touchesProfile(picked), true);
  assert.equal(settingsChip(picked, { name: 'Reviewer' }), 'Reviewer · glm-5.3/high · read-only');
  const plain = resolveSettings({ set: { model: 'glm-5.3' }, profile, ...declared });
  assert.equal(settingsChip(plain), 'glm-5.3/medium');
});
