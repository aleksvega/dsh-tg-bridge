// The headless CLI reports a turn that produced no answer as its last assistant
// text — the reasoning. The bridge used to forward that as the reply, so a turn
// cut short showed the chat a page of English thinking and no answer. The guard
// has to catch that without swallowing a real reply that happens to be short.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { looksLikeReasoning } from '../panel.mjs';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');

const reasoning = [
  'Key hypothesis: lastTurnText picks the LAST text part of the turn, but the',
  'session file may store reasoning as type text. So the sender must compare the',
  'final text with the reasoning block before sending it to the chat.',
].join(' ');
const answer = [
  'Key hypothesis: lastTurnText picks the LAST text part of the turn, but the',
  'session file may store reasoning as type text.',
].join(' ');

test('an answer that the reasoning already contains is an echo', () => {
  assert.equal(looksLikeReasoning(answer, reasoning), true);
});

test('whitespace and case do not hide the echo', () => {
  const spaced = answer.replace(/ /g, '\n  ').toUpperCase();
  assert.equal(looksLikeReasoning(spaced, reasoning), true);
});

test('a real answer is not an echo', () => {
  const real = 'Готово: рефакторинг влит в master, тесты 362/362, версия 1.20.0 опубликована. '
    + 'Проверь /version в теме и скажи, если что-то ведёт себя странно.';
  assert.equal(looksLikeReasoning(real, reasoning), false);
});

test('a short answer is never treated as an echo', () => {
  assert.equal(looksLikeReasoning('ok', 'ok'), false);
  assert.equal(looksLikeReasoning('Готово', reasoning), false);
});

test('empty input on either side is not an echo', () => {
  assert.equal(looksLikeReasoning('', reasoning), false);
  assert.equal(looksLikeReasoning(answer, ''), false);
  assert.equal(looksLikeReasoning(undefined, undefined), false);
});

test('the turn path checks the answer against the panel reasoning', () => {
  const source = readFileSync(join(here, 'handle-message.mjs'), 'utf8');
  assert.match(source, /looksLikeReasoning\(result\.text, progress\.reasoning\(\)\)/);
  assert.match(source, /bridge\.progress\.reasoningOnly/);
});