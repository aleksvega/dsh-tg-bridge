// The pin switch had one row and two scopes, and said neither. A person ticked
// it in a topic, the tick came back on, and the card stayed unpinned everywhere
// else: the row wrote `state.pin['chat:thread']` and every other topic read its
// own missing key. These tests hold both halves together -- the read that has to
// consult the install-wide value, and the two rows that now name which scope
// they write.
import assert from 'node:assert/strict';
import test from 'node:test';

import { pinScope } from '../control/cmd-views.mjs';
import { cardPin, commandFor, settingsButtons, settingsCurrent } from '../profile/settings-card.mjs';

// These tests read structure, not prose: a key back is enough for a label.
const t = (key) => key;

test('a tick in one topic reaches the others only when it was the global row', () => {
  const state = { pin: { '': 'on' } };
  assert.equal(cardPin(state, {}, '311217285:337382'), 'on', 'the reported bug: global on, other topic reads off');
  assert.equal(cardPin(state, {}, '311217285:336703'), 'on');
  assert.equal(cardPin(state, {}, ''), 'on');
});

test('a topic that chose for itself keeps its choice', () => {
  const state = { pin: { '': 'on', '311217285:337382': 'off' } };
  assert.equal(cardPin(state, {}, '311217285:337382'), 'off', 'off here wins over on everywhere');
  assert.equal(cardPin(state, {}, '311217285:336703'), 'on', 'and does not leak to the next topic');
});

test('the config default is the last word before off', () => {
  assert.equal(cardPin({}, { pin: 'on' }, '311217285:337382'), 'on');
  assert.equal(cardPin({ pin: {} }, { pin: true }, '311217285:337382'), 'on');
  assert.equal(cardPin({}, {}, '311217285:337382'), 'off');
  assert.equal(cardPin(undefined, undefined, '311217285:337382'), 'off', 'no state file yet is not a crash');
});

test('booleans from older state files still read as on and off', () => {
  assert.equal(cardPin({ pin: { '': true } }, {}, '311217285:337382'), 'on');
  assert.equal(cardPin({ pin: { '311217285:337382': false } }, { pin: 'on' }, '311217285:337382'), 'off');
});

test('the second word is what makes a switch global', () => {
  assert.deepEqual(pinScope('on', '1:2'), { key: '1:2', mode: 'on' });
  assert.deepEqual(pinScope('off', '1:2'), { key: '1:2', mode: 'off' });
  assert.deepEqual(pinScope('on all', '1:2'), { key: '', mode: 'on' });
  assert.deepEqual(pinScope('  OFF   ALL ', '1:2'), { key: '', mode: 'off' });
  assert.equal(pinScope('', '1:2'), null, 'no argument asks for the state, it does not write');
  assert.equal(pinScope('all', '1:2'), null, 'a scope without a value is not a switch');
  assert.equal(pinScope('on everywhere', '1:2'), null, 'an unknown scope must not be read as "this topic"');
  assert.equal(pinScope('on all now', '1:2'), null);
});

test('the card offers both scopes, and the global row writes the global key', () => {
  const buttons = settingsButtons({ t, current: settingsCurrent({ state: {}, config: {}, key: '1:2' }) });
  const own = buttons.filter((b) => b.row.id === 'pin');
  const all = buttons.filter((b) => b.row.id === 'pinAll');

  assert.equal(own.length, 2);
  assert.equal(all.length, 2, 'a second row, because one row could not say which scope it wrote');
  assert.deepEqual(all.map((b) => b.command), ['/pin on all', '/pin off all']);
  assert.deepEqual(own.map((b) => b.command), ['/pin on', '/pin off']);
});

test('the tick on the global row reflects the global value in a topic with no choice', () => {
  const current = settingsCurrent({ state: { pin: { '': 'on' } }, config: {}, key: '1:2' });
  const buttons = settingsButtons({ t, current });

  assert.equal(current.pin, 'on');
  assert.equal(current.pinAll, 'on');
  const on = buttons.find((b) => b.row.id === 'pinAll' && b.value === 'on');
  const off = buttons.find((b) => b.row.id === 'pinAll' && b.value === 'off');
  assert.equal(on.active, true);
  assert.equal(off.active, false);
});

test('a press on the global row runs the command that writes the global key', () => {
  const current = settingsCurrent({ state: {}, config: {}, key: '1:2' });
  const press = commandFor({ t, current }, 'm:pinAll:on');
  assert.equal(press.command, '/pin on all');
  assert.equal(press.page, 'reply');
  assert.equal(commandFor({ t, current }, 'm:pin:off').command, '/pin off');
});
