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
  // `readVoiceIntoText` answers `{ text, fatal }` so a refused key can stop the
  // rest of a batch; the transcript still has to reach the prompt as a note.
  const calls = source.match(/parts\.push\(voicePromptText\(heard\.text, lang\)\)/g) || [];
  assert.equal(calls.length, 2, 'a voice note and an audio document are both transcripts');
  assert.doesNotMatch(source, /parts\.push\(heard\)/);
});

// A voice note recorded while a turn is already running reaches the model as a
// steer, not as a new message. The person asked whether that path keeps the
// warning; `mediaPrompt` builds both, so the note is not something the steer
// branch can lose without this test failing.
test('a mid-turn voice addition carries the same note', () => {
  const steer = readFileSync(join(here, 'turn', 'steer.mjs'), 'utf8');
  assert.match(steer, /mediaPrompt\(list,[^)]*\{[^}]*steer: true/s, 'the steer path builds its text from mediaPrompt');
  const media = readFileSync(join(here, 'chat', 'media.mjs'), 'utf8');
  // The transcript is a `parts.push` inside `mediaPrompt` itself, which is the
  // function the steer calls — so a steer cannot bypass it.
  assert.match(media, /parts\.push\(voicePromptText\(heard\.text, lang\)\)/);
  assert.doesNotMatch(steer, /t\(lang, 'prompt\.voice'/);
});
