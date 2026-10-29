// Switching the model is also choosing the route it runs on.
//
// `/model <id>` used to rewrite only the model name, so asking for the SAME model
// on a different provider silently kept the old one — and the whole reason to ask
// was that the old provider was slow or refusing. `provider/model` now moves both
// halves, and a provider the profile does not declare is refused before the file
// is written, because a patch naming an unknown route is a bot that cannot answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'dsh-model-switch-'));
process.env.DSH_HOME = home;
delete process.env.DSH_PROFILE;
const patch = [
  // The indentation is the real one, not a tidy one: modelsOf reads a model
  // list at exactly eight spaces, so a fixture that indents differently tests a
  // shape no profile has.
  'plugins:',
  '  - id: llm',
  '    config:',
  '      providers:',
  '        alpha:',
  '          api: openai-responses',
  '          baseURL: https://alpha.example/v1',
  '          apiKeyEnv: ALPHA_KEY',
  '        beta:',
  '          api: openai-completions',
  '          baseURL: https://beta.example/v1',
  '          apiKeyEnv: BETA_KEY',
  '  - id: models',
  '    config:',
  '      providers:',
  '        alpha:',
  '        models:',
  '          - id: deepseek-v4.1-flash',
  '          - id: glm-5.3',
  '        beta:',
  '        models:',
  '          - id: deepseek-v4.1-flash',
  '  - id: agent-default-model',
  '    config:',
  '      provider: alpha',
  '      model: glm-5.3',
  '      reasoningEffort: max',
].join('\n');
const dir = join(home, 'profiles', 'headless');
mkdirSync(dir, { recursive: true });
const patchFile = join(dir, 'cordis.patch.yml');
writeFileSync(patchFile, patch);

const { modelOf, setModel } = await import('../control/models.mjs');
const after = () => readFileSync(patchFile, 'utf8');

test('a bare model id moves the model and leaves the route alone', () => {
  writeFileSync(patchFile, patch);
  assert.equal(setModel('headless', 'deepseek-v4.1-flash'), true);
  assert.deepEqual(modelOf('headless'), { provider: 'alpha', model: 'deepseek-v4.1-flash' });
});

test('provider/model moves the route too, which is the whole point of asking', () => {
  writeFileSync(patchFile, patch);
  assert.equal(setModel('headless', 'beta/deepseek-v4.1-flash'), true);
  assert.deepEqual(modelOf('headless'), { provider: 'beta', model: 'deepseek-v4.1-flash' });
  // Everything else in the row survives: a switch that quietly dropped
  // `reasoningEffort` would change how the model thinks, not just who serves it.
  assert.match(after(), /reasoningEffort: max/);
});

test('a model or a provider the profile does not declare is refused, file untouched', () => {
  writeFileSync(patchFile, patch);
  assert.equal(setModel('headless', 'beta/not-a-model'), false);
  assert.equal(setModel('headless', 'gamma/deepseek-v4.1-flash'), false, 'an undeclared provider cannot boot a turn');
  assert.equal(after(), patch, 'a refused switch must not leave a half-edited patch');
});
