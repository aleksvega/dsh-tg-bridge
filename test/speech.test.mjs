// What `/voice` promises: the text is spoken when asked, and never at its cost.
//
// Nothing here calls a real engine or the network. The interesting behaviour is
// not "did audio appear" — that is the person's ears — but the four rules that
// decide whether the feature is safe: off means nothing runs, a broken engine
// costs the sound and not the answer, the text handed to the engine is speakable,
// and the setting belongs to one topic.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_VOICES, MAX_SPEECH_CHARS, forSpeech, providerArgs, setSpeech, speak, speechConfig, speechOf,
} from '../chat/speech.mjs';
import { deliverAnswer } from '../chat/reply-guard.mjs';

const silentLog = () => {};

test('the voice is off until a topic asks for it', () => {
  const state = {};
  assert.equal(speechOf(state, '1:2', {}, 'ru').on, false);
  // A config with voices does not turn sound on by itself: audio nobody asked
  // for is the one failure a person cannot undo by reading.
  assert.equal(speechOf(state, '1:2', { speech: { voices: { ru: 'x' } } }, 'ru').on, false);
});

test('the setting belongs to one topic, not to the install', () => {
  const state = {};
  setSpeech(state, '1:2', { on: true }, {}, 'ru');
  assert.equal(speechOf(state, '1:2', {}, 'ru').on, true);
  assert.equal(speechOf(state, '1:3', {}, 'ru').on, false, 'another topic was switched on too');
});

test('a language without a named voice falls back to a male one, not to silence', () => {
  const state = {};
  setSpeech(state, '1:2', { on: true }, {}, 'ru');
  assert.equal(speechOf(state, '1:2', {}, 'ru').voice, DEFAULT_VOICES.ru);
  assert.equal(speechOf(state, '1:2', {}, 'de').voice, DEFAULT_VOICES.ru, 'an unknown language has no voice of its own');
});

test('a speakable text keeps words and drops markup, code and links', () => {
  const said = forSpeech('**Готово.** Код:\n```js\nconst a = 1;\n```\nСсылка: [документ](https://example.com/x) и `файл.js`.');
  assert.match(said, /Готово/);
  assert.match(said, /документ/);
  assert.doesNotMatch(said, /\*\*|```|https?:|`/);
  assert.doesNotMatch(said, /const a = 1/, 'a code block is read, not listened to');
});

test('a long answer is cut at a sentence, not in the middle of a word', () => {
  const long = `${'Первое предложение. '.repeat(40)}Хвост, который уже не читают.`;
  const said = forSpeech(long, 120);
  assert.ok(said.length <= 120, `the cut left ${said.length} characters`);
  assert.ok(said.endsWith('.'), 'a voice that stops mid-sentence sounds like a fault');
  assert.doesNotMatch(said, /Хвост/);
});

test('the default cap is a message, not a document', () => {
  assert.equal(MAX_SPEECH_CHARS, 1200);
  assert.equal(speechConfig({}).maxChars, MAX_SPEECH_CHARS);
});

test('edge-tts receives the voice, the text and where to write it', () => {
  const { command, args } = providerArgs({ provider: 'edge-tts', python: 'python', voice: 'ru-RU-DmitryNeural' }, { text: 'привет', mp3: 'out.mp3' });
  assert.equal(command, 'python');
  assert.deepEqual(args.slice(0, 2), ['-m', 'edge_tts']);
  assert.ok(args.includes('ru-RU-DmitryNeural'));
  assert.ok(args.includes('привет'));
  assert.ok(args.includes('out.mp3'));
});

test('another engine is config, not a code change', () => {
  const { command, args } = providerArgs({ provider: 'piper', command: 'piper.exe', args: ['--model', 'ru.onnx', '--output_file', '{out}'] }, { text: 'привет', mp3: 'out.wav' });
  assert.equal(command, 'piper.exe');
  assert.deepEqual(args, ['--model', 'ru.onnx', '--output_file', 'out.wav']);
});

test('sound off means nothing runs at all', async () => {
  // The provider is a command that would leave a file behind if it ever ran, so
  // "off" has to mean no process, not a process whose output nobody sends.
  const marker = `${MAX_SPEECH_CHARS}-never-written.mp3`;
  const spoken = await speak({
    chatId: 1, threadId: 2, state: {}, key: '1:2', text: 'привет',
    config: { speech: { provider: marker } },
    log: silentLog,
  });
  assert.equal(spoken, false);
});

test('a broken engine costs the sound, never the answer', async () => {
  const state = {};
  setSpeech(state, '1:2', { on: true }, {}, 'ru');
  const lines = [];
  // A provider that cannot exist: the failure must come back as `false`, not as
  // a rejected promise, because the caller fires this after the text was sent.
  const spoken = await speak({
    chatId: 1, threadId: 2, state, key: '1:2', text: 'привет',
    config: { speech: { provider: 'no-such-engine-anywhere' } },
    log: (line) => lines.push(line),
  });
  assert.equal(spoken, false);
  assert.ok(lines.some((line) => /speech failed/.test(line)), 'a silent failure is never a silent feature');
});

test('the answer is sent as text first, and the sound follows', async () => {
  const order = [];
  await deliverAnswer({
    send: async (chatId, text) => order.push(['text', text]),
    chatId: 1, threadId: 2, state: {}, key: '1:2', text: '', empty: 'пусто', config: {}, lang: 'ru', log: silentLog,
    say: async ({ text }) => order.push(['say', text]),
  });
  assert.deepEqual(order, [['text', 'пусто'], ['say', 'пусто']]);
});
