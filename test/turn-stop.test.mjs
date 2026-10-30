// What a finished turn reports: an answer, a failure, or a deliberate stop.
//
// The bug this covers was reported twice from the chat: a turn the person
// stopped with /stop came back as «CLI завершился с кодом {code} без вывода» — a
// failure sentence with the placeholder still in it, because a killed child
// reports `code === null` and `t()` only fills variables it is given a value for.
// The second half of the bug was the word «сбой»: stopping on purpose is not a
// failure, and a card that says so teaches people to distrust the stop button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { turnOutcome } from '../turn/turn-outcome.mjs';
import { t } from '../core/i18n.mjs';

test('a stop is not a failure, and leaves no error text behind', () => {
  const out = turnOutcome({ code: null, stopped: true, stderr: 'Error: killed', stdout: '', lang: 'ru' });
  assert.equal(out.stopped, true);
  assert.equal(out.error, '');
  assert.equal(out.text, '');
});

test('a stop keeps whatever the turn had already answered', () => {
  const out = turnOutcome({ code: null, stopped: true, finalText: 'half an answer', lang: 'en' });
  assert.equal(out.text, 'half an answer');
  assert.equal(out.error, '');
});

test('a clean exit is an answer, not a stop', () => {
  const out = turnOutcome({ code: 0, stopped: false, finalText: 'done', lang: 'en' });
  assert.deepEqual(out, { text: 'done', error: '', stopped: false });
});

test('a kill nobody asked for is still a failure', () => {
  // The flag is per turn: a crash right after somebody else's /stop must not be
  // relabelled as a stop just because the set was non-empty a moment ago.
  const out = turnOutcome({ code: null, stopped: false, stderr: '', stdout: '', lang: 'en' });
  assert.equal(out.stopped, false);
  assert.match(out.error, /code \?/);
  assert.doesNotMatch(out.error, /\{code\}/);
});

test('the placeholder never reaches the chat, in any language', () => {
  // `code` is null on a signal kill. Whatever the platform reports, the sentence
  // has to read as a sentence: a literal `{code}` is the one thing a person
  // cannot act on.
  for (const lang of ['en', 'ru', 'zh']) {
    const out = turnOutcome({ code: null, stopped: false, stderr: '', stdout: '', lang });
    assert.doesNotMatch(out.error, /\{code\}/, `${lang} printed the raw placeholder`);
    assert.match(out.error, /\?/, `${lang} lost the unknown exit code entirely`);
  }
  assert.equal(t('ru', 'bridge.error.cliDied', { code: '?' }).includes('{code}'), false);
});

test('the real cause wins over the generic sentence', () => {
  // stderr first: the CLI puts its own error line there.
  const withErr = turnOutcome({ code: 1, stopped: false, stderr: '  pending (waiting for service: speechToText) ', lang: 'en' });
  assert.equal(withErr.error, 'pending (waiting for service: speechToText)');
  // Then the tail of stdout, without the JSON events the bridge itself parses.
  const withOut = turnOutcome({ code: 1, stopped: false, stdout: '{"type":"x"}\nreal problem here\n', lang: 'en' });
  assert.equal(withOut.error, 'real problem here');
  // A long tail is cut, because a chat message has a size limit.
  const long = turnOutcome({ code: 1, stopped: false, stdout: `${'x'.repeat(5000)}`, lang: 'en' });
  assert.equal(long.error.length, 1200);
  assert.match(long.error, /x{100}$/);
});
