// The rewind card and its buttons, including the two cases that would delete too
// much: a press while a turn is running, and a second press of the same button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { allTurns } from '../work/rewind.mjs';
import { answerRewindPress, cutSession, isRewindPress } from '../work/rewind-buttons.mjs';
import { renderRewindCard, renderRewindUsage } from '../work/rewind-card.mjs';
import { t } from '../core/i18n.mjs';
import { writeSession } from './rewind-fixture.mjs';

const THREE = [
  { user: 'Сделай откат хода', answer: 'Понял не так' },
  { user: 'А теперь про меню', answer: 'Хорошо' },
  { user: 'Последняя правка', answer: 'Принял' },
];
const SESSION = 'session-abcd1234';

/** Everything a press needs, wired to one temp session file. */
function rig(lang = 'en') {
  const { file } = writeSession(THREE, { tools: true });
  const tr = (key, vars) => t(lang, key, vars);
  const card = renderRewindCard({ t: tr, file, sessionId: SESSION, steps: 2, lang });
  const [confirm] = card.keyboard[0];
  const [undo, cancel] = card.keyboard[1];
  const used = new Set();
  const ctx = (busy = false) => ({
    sessionId: SESSION,
    busy,
    cut: (steps) => cutSession(file, steps, () => {
      const { applyRewind } = rewindApi;
      return applyRewind(file, requirePlan(file, steps).offset, requirePlan(file, steps).size);
    }),
    undo: () => ({ error: 'nothing' }),
  });
  return { file, tr, card, confirm, undo, cancel, used, ctx };
}

// Imported lazily so the rig above reads as what the button sees.
const rewindApi = await import('../work/rewind.mjs');
const { planRewind } = rewindApi;
function requirePlan(file, steps) {
  const plan = planRewind(file, steps);
  if (plan.reason) throw new Error(plan.reason);
  return plan;
}

test('the card names every turn that will leave, and the one that stays', () => {
  const { card } = rig('ru');
  assert.match(card.text, /ход 2/);
  assert.match(card.text, /ход 3/);
  assert.match(card.text, /продолжится с хода 1/);
  assert.match(card.text, /Файлы не трогаются/);
});

test('the card is drawn in the language asked for', () => {
  assert.match(rig('zh').card.text, /回退 2 轮/);
  assert.match(rig('en').card.text, /Going back 2 turn/);
});

test('the card says how many turns go, and the button repeats the number', () => {
  const { card, confirm } = rig();
  assert.equal(confirm.callback_data, `rw:y:2:abcd1234`);
  assert.match(card.text, /2/);
});

test('only rewind buttons are recognised as rewind presses', () => {
  assert.equal(isRewindPress('rw:y:1:abcd1234'), true);
  assert.equal(isRewindPress('m:reply'), false);
  assert.equal(isRewindPress('stop'), false);
});

test('cancel removes nothing and says so', () => {
  const { tr, cancel, ctx, file } = rig();
  const said = answerRewindPress(cancel.callback_data, { t: tr, ctx: ctx() });
  assert.match(said, /Nothing was removed/);
  assert.equal(allTurns(file).length, 3);
});

test('a press while a turn runs removes nothing', () => {
  const { tr, confirm, ctx, file } = rig();
  const said = answerRewindPress(confirm.callback_data, { t: tr, ctx: ctx(true) });
  assert.match(said, /turn is running/);
  assert.equal(allTurns(file).length, 3);
});

test('confirm cuts exactly the turns the card promised', () => {
  const { tr, confirm, ctx, file } = rig();
  const said = answerRewindPress(confirm.callback_data, { t: tr, ctx: ctx() });
  assert.match(said, /Went back 2 turn/);
  assert.deepEqual(allTurns(file).map((turn) => turn.turn), [1]);
});

test('a second press of the same button cuts nothing more', () => {
  const { tr, confirm, ctx, used, file } = rig();
  answerRewindPress(confirm.callback_data, { t: tr, ctx: ctx(), used });
  const again = answerRewindPress(confirm.callback_data, { t: tr, ctx: ctx(), used });
  assert.match(again, /older session|stale|Nothing/i);
  assert.deepEqual(allTurns(file).map((turn) => turn.turn), [1]);
});

test('a button from another session acts on nothing', () => {
  const { tr, card, ctx, file } = rig();
  const foreign = { callback_data: 'rw:y:2:99999999' };
  const said = answerRewindPress(foreign.callback_data, { t: tr, ctx: ctx() });
  assert.match(said, /older session/);
  assert.equal(allTurns(file).length, 3);
  void card;
});

test('garbage callback data is answered, not ignored', () => {
  const { tr, ctx } = rig();
  assert.match(answerRewindPress('rw:y:x:abcd1234', { t: tr, ctx: ctx() }), /older session/);
});

test('refusals are said in the reader\'s language', () => {
  const { file } = writeSession([{ user: 'one', answer: 'A' }]);
  const tr = (key, vars) => t('ru', key, vars);
  const card = renderRewindCard({ t: tr, file, sessionId: SESSION, steps: 1, lang: 'ru' });
  assert.match(card.text, /ничего/i, 'one turn cannot be cut when nothing would remain');
});

test('the usage card offers the last turns as buttons', () => {
  const { file } = writeSession(THREE);
  const { text, keyboard } = renderRewindUsage({ t: (k, v) => t('en', k, v), file, sessionId: SESSION });
  assert.match(text, /Последняя правка|Последняя/);
  assert.equal(keyboard[0].length, 3);
  assert.equal(keyboard[0][0].callback_data, `rw:n:1:abcd1234`);
});

test('a session with no turns gets a usage card with no buttons', () => {
  const { file } = writeSession([]);
  const { keyboard } = renderRewindUsage({ t: (k, v) => t('en', k, v), file, sessionId: SESSION });
  assert.deepEqual(keyboard, []);
});