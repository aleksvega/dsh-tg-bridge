// The fixture is the bug as it appeared: a Russian answer with the model's English
// plan left on top of it. The guard is deterministic, so it can be held to exactly
// that shape — and held off everything that only looks like it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { scrubReply, speaksLang, scriptProfile } from '../chat/answer-shape.mjs';

const LEAK = [
  'Live page confirmed: language bar + three blocks.',
  '',
  'Now the answer to "это всегда на русском?" — no: page has all three, but it was Russian-first and the bar was missing; now fixed. Also docs index fixed.',
  '',
  'Should I update the goal task list? No new task arises (no task about docs). Per protocol, only add if the turn adds/finishes a task. Not needed.',
  '',
  'Final answer in Russian, short.',
  '',
  'Mention: /help остаётся на языке темы (правильно), страница несёт все три.',
  '',
  'Also the installer was already launched last turn — no need.',
  '',
  'Keep ~5 lines.Нет, страница не только на русском — но так выглядела, потому что начиналась с русского и не говорила, что внутри ещё два языка. Исправил.',
  '',
  'Теперь страница открывается с языковой строки: English · Русский · 中文, и в каждом языке — весь список целиком.',
].join('\n');

test('an English plan in front of a Russian answer never reaches the chat', () => {
  const out = scrubReply(LEAK, 'ru');
  assert.doesNotMatch(out.text, /Should I update the goal task list/);
  assert.doesNotMatch(out.text, /Keep ~5 lines/);
  assert.doesNotMatch(out.text, /Final answer in Russian/);
  assert.match(out.text, /Нет, страница не только на русском/);
  assert.match(out.text, /языковой строки/);
  assert.ok(out.dropped >= 3, `dropped ${out.dropped} lines, expected the whole plan`);
});

test('a clean Russian answer is not touched, character for character', () => {
  const good = 'Готово: страница теперь на трёх языках.\n\nВ чате /help отвечает на языке темы.';
  const out = scrubReply(good, 'ru');
  assert.equal(out.text, good);
  assert.equal(out.dropped, 0);
});

test('an English answer in an English conversation is not touched', () => {
  const english = 'Done: the page now carries all three languages.\n\nShould I update the goal list? No.';
  const out = scrubReply(english, 'en');
  assert.equal(out.text, english);
  assert.equal(out.dropped, 0);
});

test('English quoted inside code or in an answer body survives', () => {
  const withCode = ['Готово. Вот что поменялось:', '', '```js', '// Now the answer is sent', 'const x = 1;', '```', '', 'Это всё.'].join('\n');
  assert.equal(scrubReply(withCode, 'ru').text, withCode);

  const quoted = 'Он спросил "should I update the goal list?" — я ответил нет.';
  assert.equal(scrubReply(quoted, 'ru').text, quoted);
});

test('a Chinese conversation strips Latin planning the same way', () => {
  const leak = ['Let me check the page.', '', '页面现在有三种语言，/help 用话题语言回答。'].join('\n');
  const out = scrubReply(leak, 'zh');
  assert.doesNotMatch(out.text, /Let me check/);
  assert.match(out.text, /三种语言/);
});

test('the guard never empties an answer', () => {
  const onlyPlan = 'Now the answer.\n\nKeep ~5 lines.';
  const out = scrubReply(onlyPlan, 'ru');
  assert.equal(out.text, onlyPlan.trimEnd());
  assert.equal(out.dropped, 0);
});

test('a reply in the wrong language is reported, not rewritten', () => {
  const out = scrubReply('Done. The page has three languages now.', 'ru');
  assert.equal(out.text, 'Done. The page has three languages now.');
  assert.equal(out.foreign, true);
});

test('script counting is the base the rules stand on', () => {
  const ru = scriptProfile('Привет, мир');
  assert.equal(ru.cyrillic, 9);
  assert.equal(ru.latin, 0);
  assert.equal(speaksLang('Привет, /help', 'ru'), true);
  assert.equal(speaksLang('Hello', 'ru'), false);
  assert.equal(speaksLang('你好', 'zh'), true);
  assert.equal(speaksLang('', 'ru'), true);
});