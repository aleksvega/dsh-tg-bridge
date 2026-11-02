// The tour: five cards that answer "what is this for", not "what is the syntax".
//
// What it must never do: promise a command that does not exist, or draw a card
// Telegram refuses. Both are checked here, in every language.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { CONTROL_COMMANDS } from '../chat/commands-registry.mjs';
import { PAGES, TRY, tourCard } from '../chat/tour.mjs';

test('every page draws in every language and fits one message', () => {
  for (const lang of ['en', 'ru', 'zh']) {
    for (let step = 1; step <= PAGES; step += 1) {
      const card = tourCard(step, lang);
      assert.ok(card.text.length > 40, `${lang}/${step} is too thin to explain anything`);
      assert.ok(card.text.length < 4000, `${lang}/${step} does not fit a Telegram message`);
      assert.ok(Array.isArray(card.keyboard) && card.keyboard.length >= 2, `${lang}/${step} needs a way out`);
    }
  }
});

test('the first page has no back, the last has no next', () => {
  const first = JSON.stringify(tourCard(1, 'en').keyboard);
  const last = JSON.stringify(tourCard(PAGES, 'en').keyboard);
  assert.ok(!first.includes('tr:page:0'), 'the first page must not offer a step below it');
  assert.ok(first.includes(`tr:page:2`), 'the first page must offer the next step');
  assert.ok(!last.includes(`tr:page:${PAGES + 1}`), 'the last page must not offer a step past it');
  assert.ok(last.includes('tr:done'), 'the last page must let the person leave');
});

test('a stale button is clamped, not a crash', () => {
  assert.equal(tourCard(0, 'en').text, tourCard(1, 'en').text);
  assert.equal(tourCard(99, 'en').text, tourCard(PAGES, 'en').text);
  assert.equal(tourCard(NaN, 'en').text, tourCard(1, 'en').text);
});

test('every card offers a command the bridge actually has', () => {
  assert.equal(TRY.length, PAGES);
  for (const cmd of TRY) {
    assert.ok(CONTROL_COMMANDS.includes(cmd), `the tour promises /${cmd}, which is not a command`);
  }
});

test('the last card ends with what a person needs after the tour', () => {
  const body = tourCard(PAGES, 'ru').text;
  assert.match(body, /\/menu/, 'the tour should end where every command is');
  assert.match(body, /\/help/, 'and where one command is explained');
});