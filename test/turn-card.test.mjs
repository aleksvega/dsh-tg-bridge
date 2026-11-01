// The turn card's switches: what a topic keeps, and what the reply looks like.
//
// The card is the one message every turn ends with, so its shape is a matter of
// taste and the choice has to survive a restart — hence `state`, not memory.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { CARD_BLOCKS, cardBlocks, cardKeyboard, renderCardSettings, toggleCardBlock } from '../turn/card.mjs';
import { progressPanel } from '../chat/panel.mjs';

const EN = { lang: 'en' };
const RU = { lang: 'ru' };
const ZH = { lang: 'zh' };

test('a topic that never chose keeps every block', () => {
  assert.deepEqual([...cardBlocks({}, 'CHAT:TOPIC')], CARD_BLOCKS);
});

test('a stored choice is read back in the card order', () => {
  const state = { cardBlocks: { 'CHAT:TOPIC': ['steps', 'time'] } };
  assert.deepEqual([...cardBlocks(state, 'CHAT:TOPIC')], ['time', 'steps']);
});

test('an id this build no longer knows is dropped, not rendered', () => {
  const state = { cardBlocks: { 'CHAT:TOPIC': ['time', 'gone'] } };
  assert.deepEqual([...cardBlocks(state, 'CHAT:TOPIC')], ['time']);
});

test('toggling flips one block and keeps the rest', () => {
  const first = toggleCardBlock({}, 'CHAT:TOPIC', 'steps');
  assert.ok(!first.includes('steps'));
  assert.ok(first.includes('time'));
  const back = toggleCardBlock({ cardBlocks: { 'CHAT:TOPIC': first } }, 'CHAT:TOPIC', 'steps');
  assert.ok(back.includes('steps'));
});

test('toggling an unknown block is a refusal, not a write', () => {
  assert.equal(toggleCardBlock({}, 'CHAT:TOPIC', 'nonsense'), null);
});

test('the card renders in every locale, and an empty choice says so', () => {
  for (const { lang } of [EN, RU, ZH]) {
    const text = renderCardSettings(cardBlocks({}, 'CHAT:TOPIC'), lang);
    assert.ok(text.length > 10, `${lang}: empty card`);
    assert.doesNotMatch(text, /card\./, `${lang}: a key leaked into the text`);
    const empty = renderCardSettings(new Set(), lang);
    assert.notEqual(empty, text);
    assert.doesNotMatch(empty, /card\./, `${lang}: a key leaked into the empty text`);
  }
});

test('the keyboard has one button per block and marks the chosen ones', () => {
  const rows = cardKeyboard(cardBlocks({}, 'CHAT:TOPIC'), 'en');
  const buttons = rows.flat();
  assert.equal(buttons.length, CARD_BLOCKS.length);
  for (const button of buttons) assert.match(button.callback_data, /^tc:[a-z]+$/);
  assert.ok(buttons.every((button) => button.text.startsWith('✅')));
});

test('the panel drops the blocks this topic switched off', () => {
  const full = progressPanel({
    lang: 'en', seconds: 12, final: true, steps: ['a', 'b'], thoughts: ['thinking'],
    cache: 'cache 10%', money: 'cost $1', context: 'ctx 5%',
  });
  const lean = progressPanel({
    lang: 'en', seconds: 12, final: true, steps: ['a', 'b'], thoughts: ['thinking'],
    cache: 'cache 10%', money: 'cost $1', context: 'ctx 5%',
    blocks: new Set(['time']),
  });
  assert.ok(full.plain.includes('cache 10%'));
  assert.ok(!lean.plain.includes('cache 10%'), 'cache survived a switch-off');
  assert.ok(!lean.plain.includes('cost $1'), 'cost survived a switch-off');
  assert.ok(!lean.plain.includes('ctx 5%'), 'context survived a switch-off');
  assert.ok(!lean.plain.includes('thinking'), 'thoughts survived a switch-off');
  // The head is not a block: a card without a duration is not a summary.
  assert.match(lean.plain, /12/);
});
