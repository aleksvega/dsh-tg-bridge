// A voice note is recognised by a speech model, not typed, and the transcript
// arrives without that fact. "dodge" heard as "дождь" turns a car into weather,
// and the agent answers the sentence it was given instead of the one that was
// spoken. The prompt has to say where its words came from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { voicePromptText } from '../chat/media.mjs';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');

test('a transcript carries the fact that it was recognised, not typed', () => {
  const text = voicePromptText('привет, у меня не работает dodge', 'ru');
  assert.match(text, /расшифровка/i, 'the note must name the source');
  assert.match(text, /додумыв|спроси/i, 'the note must ask for a question instead of a guess');
  assert.match(text, /привет, у меня не работает dodge/, 'the transcript itself must survive intact');
  assert.ok(text.trim().endsWith('dodge'), 'the note goes above the words, not after them');
});

test('every locale has the note, and it is not a placeholder', () => {
  const words = {
    en: [/transcript/i, /ask/i],
    ru: [/расшифровка/i, /спроси/i],
    zh: [/转写|语音/, /询问|不要/],
  };
  for (const [lang, patterns] of Object.entries(words)) {
    const text = voicePromptText('some words', lang);
    for (const pattern of patterns) assert.match(text, pattern, `${lang} must explain ${pattern}`);
    assert.doesNotMatch(text, /\{text\}/, `${lang} must interpolate the transcript`);
  }
});

test('an empty transcript does not leave a dangling note', () => {
  assert.doesNotMatch(voicePromptText('', 'ru'), /^\s*$/);
});

test('both voice paths in the prompt go through the note', () => {
  const source = readFileSync(join(here, 'chat', 'media.mjs'), 'utf8');
  const calls = source.match(/parts\.push\(voicePromptText\(heard, lang\)\)/g) || [];
  assert.equal(calls.length, 2, 'a voice note and an audio document are both transcripts');
  assert.doesNotMatch(source, /parts\.push\(heard\)/);
});