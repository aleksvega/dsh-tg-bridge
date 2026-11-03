// The headless CLI reports a turn that produced no answer as its last assistant
// text — the reasoning. The bridge used to forward that as the reply, so a turn
// cut short showed the chat a page of English thinking and no answer. The guard
// has to catch that without swallowing a real reply that happens to be short.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { looksLikeReasoning, stripThinkingBlocks } from '../chat/panel.mjs';
import { replyText } from '../chat/reply-guard.mjs';

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
  const guard = readFileSync(join(here, 'chat', 'reply-guard.mjs'), 'utf8');
  assert.match(guard, /looksLikeReasoning\(value, reasoning\)/);
  assert.match(guard, /isReasoningEcho\(value, reasoning\(\)\)/);
  assert.match(guard, /REPLY_NUDGE/);
  const source = readFileSync(join(here, 'chat', 'handle-message.mjs'), 'utf8');
  assert.match(source, /replyText\(/);
  assert.match(source, /bridge\.progress\.reasoningOnly/);
});

// The shape that got past the guard in 1.38.1: some routes stream reasoning into
// the text channel, so the reply literally begins with a thinking marker and the
// reasoning block does not contain that marker. The guard missed it and the chat
// received the model's notes.
test('a reply that is a thinking marker and nothing else is an echo', () => {
  const said = `<thinking${reasoning}`;
  assert.equal(looksLikeReasoning(said, reasoning), true);
});

test('a closed thinking block is dropped whole', () => {
  // A fenced block is reasoning by construction: whatever it holds must not
  // reach the chat, and the comparison then has nothing left to compare.
  assert.equal(stripThinkingBlocks(`<thinking>${reasoning}</thinking>`), '');
  assert.equal(stripThinkingBlocks(`before <thinking>${reasoning}</thinking> after`), 'before   after');
  assert.equal(looksLikeReasoning(`<thinking>${reasoning}</thinking>`, reasoning), true);
});

test('an unclosed marker is removed and the rest is kept', () => {
  assert.equal(stripThinkingBlocks(`<thinking${answer}`), answer);
});

test('a real reply with a leaked marker keeps its text', () => {
  const real = 'Готово: релиз 1.38.2 собран, тесты зелёные, тег на GitHub.';
  assert.equal(stripThinkingBlocks(`<thinking notes>\n\n${real}`), `notes>\n\n${real}`);
  assert.equal(stripThinkingBlocks(real), real);
});

// The retry is the actual fix for "the turn ended without an answer": asking once
// more in the same session turns a reasoning echo into a real reply instead of an
// apology. Both branches have to be true, so both are asserted.
test('a reasoning echo is retried once and the real answer is used', async () => {
  const lines = [];
  const result = { text: `<thinking${reasoning}`, error: '' };
  const out = await replyText({
    result,
    reasoning: () => reasoning,
    key: '1:1',
    turnOptions: {},
    sessionId: 'session-x',
    where: 'chat topic=1',
    log: (line) => lines.push(line),
    retryTurn: () => async () => ({ text: 'Готово: тесты 852/852, версия 1.38.2 выпущена.', error: '' }),
  });
  assert.equal(out.echoed, false);
  assert.match(out.text, /852\/852/);
  assert.match(lines.join('\n'), /asking once more/);
});

// The other side of the same defect: an answer that is real but arrives with the
// model's plan stuck on top, in the wrong language. It is not a reasoning echo,
// so the retry above never fires — the scrub in the same function has to.
test('the plan around a real reply is dropped before the chat sees it', async () => {
  const lines = [];
  const result = {
    text: 'Now the answer, short.\n\nKeep ~5 lines.Готово: страница на трёх языках.',
    error: '',
  };
  const out = await replyText({
    result,
    reasoning: () => '',
    key: '1:1',
    turnOptions: {},
    sessionId: 'session-x',
    where: 'chat topic=1',
    lang: 'ru',
    log: (line) => lines.push(line),
  });
  assert.equal(out.echoed, false);
  assert.equal(out.text, 'Готово: страница на трёх языках.');
  assert.match(lines.join('\n'), /planning line/);
});

test('a clean reply passes through the guard unchanged', async () => {
  const clean = 'Готово: 988 тестов, коммит на GitHub.\n\n/stats: страница теперь на трёх языках.';
  const out = await replyText({
    result: { text: clean, error: '' },
    reasoning: () => '',
    key: '1:1',
    turnOptions: {},
    sessionId: 'session-x',
    where: 'chat topic=1',
    lang: 'ru',
    log: () => {},
  });
  assert.equal(out.text, clean);
});

// Stripping cannot repair a reply that is entirely in another language — there is
// nothing to keep. One more ask in the same session is the only repair that costs
// the person nothing but time, so it is worth exactly one attempt.
test('a reply in the wrong language is asked for again, once', async () => {
  const lines = [];
  let asked = '';
  const english = 'Done. The page now carries all three languages and the README indexes every document.';
  const out = await replyText({
    result: { text: english, error: '' },
    reasoning: () => '',
    key: '1:1',
    turnOptions: {},
    sessionId: 'session-x',
    where: 'chat topic=1',
    lang: 'ru',
    log: (line) => lines.push(line),
    retryTurn: (prompt) => async () => {
      asked = prompt;
      return { text: 'Готово: страница на трёх языках, README перечисляет все документы.', error: '' };
    },
  });
  assert.match(asked, /Russian/);
  assert.match(out.text, /на трёх языках/);
  assert.match(lines.join('\n'), /wrong language/);
});

test('a second wrong-language answer is sent rather than swallowed', async () => {
  const english = 'Done. The page now carries all three languages and the README indexes every document.';
  const out = await replyText({
    result: { text: english, error: '' },
    reasoning: () => '',
    key: '1:1',
    turnOptions: {},
    sessionId: 'session-x',
    where: 'chat topic=1',
    lang: 'ru',
    log: () => {},
    retryTurn: () => async () => ({ text: english, error: '' }),
  });
  assert.equal(out.text, english);
});

test('a second echo is reported, not forwarded', async () => {
  const lines = [];
  const out = await replyText({
    result: { text: reasoning, error: '' },
    reasoning: () => reasoning,
    key: '1:1',
    turnOptions: {},
    sessionId: 'session-x',
    where: 'chat topic=1',
    log: (line) => lines.push(line),
    retryTurn: () => async () => ({ text: reasoning, error: '' }),
  });
  assert.equal(out.echoed, true);
  assert.equal(out.text, '');
  assert.match(lines.join('\n'), /reasoning echo suppressed/);
});

test('a failed retry is not treated as an answer', async () => {
  const result = { text: reasoning, error: '' };
  const out = await replyText({
    result,
    reasoning: () => reasoning,
    key: '1:1',
    turnOptions: {},
    sessionId: 'session-x',
    where: 'chat topic=1',
    log: () => {},
    retryTurn: () => async () => ({ text: '', error: 'CLI exited without output' }),
  });
  // The retry errored, so nothing replaced the echo: the caller still reports it
  // rather than sending an empty body.
  assert.equal(out.echoed, true);
  assert.equal(out.text, '');
  assert.equal(result.text, reasoning);
});

test('the turn path asks once more before apologising', () => {
  const source = readFileSync(join(here, 'chat', 'reply-guard.mjs'), 'utf8');
  assert.match(source, /REPLY_NUDGE/);
  assert.match(source, /asking once more/);
  // The apology must still exist for the case where the second attempt echoes too.
  assert.match(source, /reasoning echo suppressed/);
});