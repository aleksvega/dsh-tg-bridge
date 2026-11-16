// What `/voice` promises: the text is spoken when asked, and never at its cost.
//
// Nothing here calls a real engine or the network. The interesting behaviour is
// not "did audio appear" — that is the person's ears — but the four rules that
// decide whether the feature is safe: off means nothing runs, a broken engine
// costs the sound and not the answer, the text handed to the engine is speakable,
// and the setting belongs to one topic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';

import {
  DEFAULT_VOICES, MAX_SPEECH_CHARS, forSpeech, providerArgs, setSpeech, speak, speechConfig, speechOf, speechParts,
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

test('cleaning is no longer a cut: the whole answer survives it', () => {
  const long = `${'Первое предложение. '.repeat(40)}Хвост.`;
  assert.equal(forSpeech(long).length, long.length, 'cleaning dropped words');
});

test('a long answer is spoken whole, in notes cut at sentences', () => {
  // The defect this grew out of: a 3000-char answer arrived as one 1155-char
  // voice note, and the person heard a reply that ended mid-thought. Nothing
  // may be dropped now — the last note carries the tail.
  const long = `${'Первое предложение. '.repeat(40)}Хвост, который тоже читают.`;
  const parts = speechParts(long, 120);
  assert.ok(parts.length > 1, 'a long answer is more than one note');
  assert.ok(parts.every((p) => p.length <= 120), 'a note is a message, not a document');
  assert.ok(parts.every((p) => /[.!?]$/.test(p)), 'a voice that stops mid-sentence sounds like a fault');
  assert.ok(parts.join(' ').includes('Хвост'), 'the tail was dropped');
});

test('a text without sentences splits at words, never inside one', () => {
  const parts = speechParts('слово '.repeat(100), 120);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 120));
  assert.ok(parts.every((p) => !/\s$/.test(p) || true));
  // Every note ends on a word boundary: joined with one space, the words survive.
  const words = parts.join(' ').split(/\s+/).filter(Boolean);
  assert.equal(words.length, 100, 'a word was cut in half');
});

test('a short answer is one note, not one of several', () => {
  assert.equal(speechParts('Готово.', 120).length, 1);
  assert.equal(speechParts('', 120).length, 0);
});

test('the default cap is one note, not the whole answer', () => {
  assert.equal(MAX_SPEECH_CHARS, 1200);
  assert.equal(speechConfig({}).maxChars, MAX_SPEECH_CHARS);
});

test('an engine that already speaks OGG skips the ffmpeg conversion', () => {
  // The flag was documented in VOICE.md before speechConfig read it, so a
  // Piper writing OGG still paid an ffmpeg run it did not need.
  assert.equal(speechConfig({}).ogg, false);
  assert.equal(speechConfig({ speech: { ogg: true } }).ogg, true);
  assert.equal(speechConfig({ speech: { ogg: 'true' } }).ogg, false, 'a string is not a promise');
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

test('every note of a long answer is sent, in order', async () => {
  // The sequence is the promise: the engine runs per note, the notes leave in
  // order, and one failing note never cancels the notes after it.
  const state = {};
  setSpeech(state, '1:2', { on: true }, {}, 'ru');
  const text = 'Первое предложение. '.repeat(200);
  const notes = speechParts(text, 1200);
  assert.ok(notes.length >= 3, 'this answer is long enough to be several notes');

  const lines = [];
  const spoken = await speak({
    chatId: 1, threadId: 2, state, key: '1:2', text,
    config: { speech: { provider: 'stub', command: 'stub', ogg: true } },
    log: (line) => lines.push(line),
    runner: async () => { throw new Error('engine down'); },
    sender: async (chatId, threadId, file) => notes.push(file),
  });
  assert.equal(spoken, false, 'a dead engine means no sound, not a rejection');
  assert.equal(lines.filter((l) => /speech failed for note/.test(l)).length, notes.length,
    'each note failure is its own log line');

  const sent = [];
  let runs = 0;
  const ok = await speak({
    chatId: 1, threadId: 2, state, key: '1:2', text,
    config: { speech: { provider: 'stub', command: 'stub', ogg: true } },
    log: silentLog,
    runner: async (command, args) => {
      runs += 1;
      if (runs === 2) throw new Error('one engine hiccup');
      return args.find((a) => String(a).includes('Первое'));
    },
    sender: async (chatId, threadId, file) => sent.push(basename(file)),
  });
  assert.equal(ok, true, 'a failed note is not the whole sound');
  assert.equal(runs, notes.length, 'the engine ran once per note');
  assert.equal(sent.length, notes.length - 1, 'only the hiccup note is missing');
  assert.ok(sent.includes('say-1.ogg'), 'the first note still arrives');
  assert.ok(sent.includes(`say-${notes.length}.ogg`), 'the last note still arrives');
});

test('the spoken text is the full cleaned answer', async () => {
  const state = {};
  setSpeech(state, '1:2', { on: true }, {}, 'ru');
  const said = [];
  await speak({
    chatId: 1, threadId: 2, state, key: '1:2',
    text: `${'Первое предложение. '.repeat(100)}Финал.`,
    config: { speech: { provider: 'stub', command: 'stub', ogg: true } },
    log: silentLog,
    runner: async (command, args) => { said.push(args.find((a) => String(a).includes('Первое') || String(a).includes('Финал'))); },
    sender: async () => {},
  });
  assert.ok(said.length >= 2, 'the answer is more than one engine run');
  assert.ok(said.join('').includes('Финал'), 'the last sentence was never spoken');
});
