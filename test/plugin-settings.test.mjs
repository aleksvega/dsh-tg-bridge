// Plugin settings: what the card reads out of a profile, and what a press does.
//
// The card is built from `cordis.patch.yml` rather than from a plugin channel,
// because a headless turn has none. These cases are the ones that decide whether
// it can be trusted: a boolean is a switch, a number is not, a nested block is
// named but never flipped, a key the row does not have is refused, and a value
// that the file keeps unchanged is reported as refused rather than as saved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-ps-'));
process.env.DSH_HOME = HOME;
mkdirSync(join(HOME, 'profiles', 'headless'), { recursive: true });
mkdirSync(join(HOME, 'profiles', 'other'), { recursive: true });
const PATCH = join(HOME, 'profiles', 'headless', 'cordis.patch.yml');
const OTHER = join(HOME, 'profiles', 'other', 'cordis.patch.yml');

const BASE = `# A profile as a person writes it: comments, a block, and a switch.
- id: compaction-basic
  name: '@deepseek-ai/dsh-compaction-basic'
  config:
    # the ratio is a number, not a switch
    auto: true
    thresholdRatio: 0.12
    retainTokens: 24000
- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    preset: workspace-write
`;

const reset = () => {
  writeFileSync(PATCH, BASE, 'utf8');
  writeFileSync(OTHER, BASE, 'utf8');
};
reset();

const { pluginConfig, pluginConfigOf, settingsRows, writePluginSetting, checkKey } = await import('../control/plugin-settings.mjs');
const { pluginSettingsCard, pluginSettingsList, handlePluginSettingsPress } = await import('../chat/plugin-settings-press.mjs');
const { state } = await import('../core/state.mjs');

/** A press context with a fake Telegram that records the redraw and the answer. */
function press(data, { key = 'chat:1', lang = 'en' } = {}) {
  const drawn = [];
  const answers = [];
  const ctx = {
    data,
    key,
    lang,
    chatId: 1,
    messageId: 5,
    answer: async (text) => answers.push(text),
    inlineKeyboard: (rows) => rows,
    tg: async (method, payload) => {
      drawn.push({ method, payload });
      return {};
    },
  };
  return { ctx, drawn, answers };
}

test('a boolean is a switch and a number is a value', () => {
  reset();
  const found = pluginConfigOf('headless', 'compaction-basic');
  assert.equal(found.ok, true);
  const auto = found.settings.find((s) => s.key === 'auto');
  const ratio = found.settings.find((s) => s.key === 'thresholdRatio');
  assert.equal(auto.type, 'boolean');
  assert.equal(auto.value, true);
  assert.equal(auto.editable, true);
  assert.equal(ratio.type, 'number');
  assert.equal(ratio.value, 0.12);
  // Nothing can type `0.12` from a button, so it is printed, not toggled.
  assert.equal(ratio.editable, false);
});

test('a nested block is counted, not offered as a switch', () => {
  const text = `- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      acme:
        displayName: Acme
    retries: 6
`;
  const found = pluginConfig(text, 'llm-pi-ai');
  const block = found.settings.find((s) => s.key === 'providers');
  assert.equal(block.type, 'block');
  assert.equal(block.editable, false);
  assert.ok(block.lines >= 2);
  assert.equal(found.settings.find((s) => s.key === 'retries').value, 6);
});

test('the list names only rows that have settings', () => {
  reset();
  const rows = settingsRows('headless');
  assert.deepEqual(rows.map((r) => r.id), ['compaction-basic', 'sandbox-policy']);
  assert.equal(rows[0].count, 3);
});

test('the card shows a switch only where a tap can change the value', () => {
  reset();
  const card = pluginSettingsCard('en', 'headless', 'compaction-basic');
  const labels = card.keyboard.flat().map((b) => b.text);
  assert.equal(labels.some((text) => /^auto:/.test(text)), true);
  assert.equal(labels.some((text) => /^thresholdRatio:/.test(text)), false);
  // The value itself is still on the card as text.
  assert.match(card.text, /thresholdRatio: 0\.12/);
  assert.match(card.text, /auto: on/);
});

test('a key the row does not have is refused instead of created', () => {
  reset();
  const result = writePluginSetting('headless', 'compaction-basic', 'invented', true);
  assert.equal(result.ok, false);
  assert.equal(result.why, 'unknownKey');
  assert.equal(readFileSync(PATCH, 'utf8'), BASE);
});

test('a non-boolean key cannot be written from a card', () => {
  reset();
  const result = writePluginSetting('headless', 'compaction-basic', 'thresholdRatio', 0.5);
  assert.equal(result.ok, false);
  assert.equal(result.why, 'readOnly');
  assert.equal(result.value, 0.12);
});

test('a write is read back from the file and reported as it now is', () => {
  reset();
  const result = writePluginSetting('headless', 'compaction-basic', 'auto', false);
  assert.equal(result.ok, true);
  assert.equal(result.value, false);
  assert.equal(readFileSync(PATCH, 'utf8').includes('auto: false'), true);
  assert.equal(pluginConfigOf('headless', 'compaction-basic').settings.find((s) => s.key === 'auto').value, false);
});

test('a setting is written to one profile and another keeps its own value', () => {
  reset();
  writePluginSetting('headless', 'compaction-basic', 'auto', false);
  assert.equal(readFileSync(OTHER, 'utf8').includes('auto: true'), true);
  assert.equal(readFileSync(PATCH, 'utf8').includes('auto: false'), true);
});

test('a press flips the switch, redraws the card and answers with the new value', async () => {
  reset();
  const { ctx, drawn, answers } = press('ps:r:0');
  // The list press resolves a position against the profile as it is now.
  state.psRows = { headless: ['compaction-basic', 'sandbox-policy'] };
  assert.equal(await handlePluginSettingsPress(ctx), true);
  const card = pluginSettingsCard('en', 'headless', 'compaction-basic');
  state.psCard = { 'chat:1': { id: 'compaction-basic', keys: card.keys } };
  const flip = press('ps:t:0', { key: 'chat:1' });
  state.psCard = { 'chat:1': { id: 'compaction-basic', keys: card.keys } };
  assert.equal(await handlePluginSettingsPress(flip.ctx), true);
  assert.match(flip.answers.at(-1), /auto/);
  assert.equal(pluginConfigOf('headless', 'compaction-basic').settings.find((s) => s.key === 'auto').value, false);
  assert.equal(flip.drawn.at(-1).method, 'editMessageText');
  assert.equal(drawn.at(-1).method, 'editMessageText');
});

test('a press on a card older than the profile executes nothing', async () => {
  reset();
  const { ctx, drawn, answers } = press('ps:t:0');
  state.psCard = {};
  assert.equal(await handlePluginSettingsPress(ctx), true);
  assert.match(answers.at(-1), /older|again|out of date/i);
  // Nothing was written and nothing was redrawn over the person's card.
  assert.equal(readFileSync(PATCH, 'utf8'), BASE);
  assert.deepEqual(drawn, []);
});

test('every label exists in all three locales', async () => {
  reset();
  for (const lang of ['en', 'ru', 'zh']) {
    const card = pluginSettingsCard(lang, 'headless', 'compaction-basic');
    assert.equal(/ctrl\.ps\./.test(card.text), false, `${lang} text leaks a key`);
    for (const row of card.keyboard) {
      for (const button of row) assert.equal(/ctrl\.ps\./.test(button.text), false, `${lang} button leaks a key`);
    }
    const list = pluginSettingsList(lang, 'headless');
    assert.equal(/ctrl\.ps\./.test(list.text), false, `${lang} list leaks a key`);
  }
});

test('a key name is checked before it can be a command word', () => {
  assert.equal(checkKey('auto').ok, true);
  assert.equal(checkKey('').ok, false);
  assert.equal(checkKey('a b').ok, false);
  assert.equal(checkKey('-x').ok, false);
});

test('an unknown row says so and offers no switches', () => {
  reset();
  const card = pluginSettingsCard('en', 'headless', 'not-a-row');
  assert.deepEqual(card.keyboard, []);
  assert.match(card.text, /not in profile/i);
});
