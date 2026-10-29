// The commands the suite never touched.
//
// Every documented command answers in every language, or the documentation is a
// promise the code does not keep. Six of them — `/skills`, `/soul`, `/seed`,
// `/send`, `/crew`, `/subscribe` — had no test at all: they were reachable,
// listed in `/help`, and nothing ever proved they answered.
//
// What is asserted is deliberately shallow: the command claims the message
// (returns `true`), the answer is not empty, and no `{placeholder}` survives.
// A translation that forgets a variable, or a handler that throws on a missing
// argument, is what this catches; whether the answer is *good* is not something
// a unit test can say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'commands-'));
process.env.DSH_HOME = HOME;
const { handleControl } = await import('../control.mjs');
const { DOCUMENTED_COMMANDS } = await import('../commands-registry.mjs');
const { t } = await import('../i18n.mjs');

const LANGS = ['en', 'ru', 'zh'];

function context(overrides = {}) {
  const out = [];
  const ctx = {
    command: '/status',
    arg: '',
    chatId: 42,
    threadId: 7,
    key: '42:7',
    state: { sessions: {}, profiles: {}, lang: {}, titles: {}, reminders: [] },
    config: { profile: 'test', cwd: process.cwd() },
    profile: 'test',
    lang: 'en',
    activeTurns: new Map(),
    saveState: () => {},
    log: () => {},
    send: async () => {},
    reply: (text) => { out.push(String(text)); return 1; },
    sendFile: async () => {},
    stopTurn: () => false,
    seedTopic: async () => {},
    jobs: () => ({ active: [], queued: 0, max: 3 }),
    ...overrides,
  };
  return { ctx, out };
}

const run = async (command, arg = '', overrides = {}) => {
  const built = context({ command, arg, ...overrides });
  const claimed = await handleControl(built.ctx);
  return { claimed, text: built.out.join('\n') };
};

// `/update` and `/subscribe` shell out to `npm view` with a 45-second timeout:
// offline, that is a slow test, not a wrong one, so they are left to the release
// tests that already stub the registry.
const SLOW = new Set(['update', 'subscribe']);

test('every documented command claims its message in every language', async () => {
  for (const lang of LANGS) {
    for (const command of DOCUMENTED_COMMANDS) {
      if (SLOW.has(command.replace(/^\//, ''))) continue;
      const { claimed, text } = await run(`/${command.replace(/^\//, '')}`, '', { lang });
      assert.equal(claimed, true, `${lang} /${command} was not handled`);
      // An empty answer is as bad as an unhandled command: the person typed
      // something and heard nothing back.
      assert.ok(text.trim().length > 0, `${lang} /${command} said nothing`);
      assert.doesNotMatch(text, /\{\w+\}/, `${lang} /${command} left a placeholder: ${text}`);
    }
  }
});

test('a bare home does not break the commands that read a directory', async () => {
  // `/profile` used to throw here: `readdirSync` on a `profiles/` that DSH has
  // not created yet is ENOENT, and the first command a new install runs was an
  // exception. This is the regression test for that.
  const { claimed, text } = await run('/profile', '', { lang: 'en' });
  assert.equal(claimed, true);
  assert.ok(text.trim().length > 0);
});

test('/soul shows what it has, saves what it is given', async () => {
  const empty = await run('/soul', '', { lang: 'en' });
  assert.equal(empty.claimed, true);
  assert.ok(empty.text.length > 0, 'a bare /soul said nothing');

  const saved = await run('/soul', 'be brief and answer in the language of the question', { lang: 'en' });
  assert.equal(saved.claimed, true);
  assert.equal(saved.text, t('en', 'ctrl.soul.saved'));

  // The second read has to show the text that was just written: a save that
  // does not survive the next read is a save to nowhere.
  const shown = await run('/soul', '', { lang: 'en' });
  assert.match(shown.text, /be brief/);
});

test('/skills lists what is installed, and names a miss', async () => {
  const listed = await run('/skills', '', { lang: 'en' });
  assert.equal(listed.claimed, true);
  assert.ok(listed.text.length > 0);

  // Asking for a skill that is not installed is not an error: it says so.
  const missing = await run('/skills', 'no-such-skill-anywhere', { lang: 'en' });
  assert.equal(missing.claimed, true);
  assert.match(missing.text, /no-such-skill-anywhere/);
});

test('/seed explains itself without a thread, and without text', async () => {
  const noThread = await run('/seed', 'hello', { lang: 'en', threadId: 0 });
  assert.equal(noThread.claimed, true);
  assert.equal(noThread.text, t('en', 'ctrl.seed.noThread'));

  const noText = await run('/seed', '   ', { lang: 'en' });
  assert.equal(noText.claimed, true);
  assert.equal(noText.text, t('en', 'ctrl.seed.usage'));

  // With both, the topic is seeded and the answer confirms it.
  // `seedTopic(chatId, threadId, text)` — the arguments the bridge passes, not
  // just the text: a stub that only took one argument silently swallowed two.
  const seeded = [];
  const done = await run('/seed', 'the original prompt', {
    lang: 'en',
    seedTopic: async (chatId, threadId, text) => { seeded.push({ chatId, threadId, text }); return 99; },
  });
  assert.equal(done.claimed, true);
  assert.deepEqual(seeded, [{ chatId: 42, threadId: 7, text: 'the original prompt' }]);
  // The message id is what the reply confirms, so it has to reach the answer.
  assert.match(done.text, /99/);
});

test('/crew answers the store, not a guess', async () => {
  const shown = await run('/crew', '', { lang: 'en' });
  assert.equal(shown.claimed, true);
  assert.ok(shown.text.length > 0);
  // An unknown verb is a question, not a crash.
  const asked = await run('/crew', 'nonsense-verb', { lang: 'en' });
  assert.equal(asked.claimed, true);
  assert.ok(asked.text.length > 0);
});

test('/send refuses a file that is not there instead of going quiet', async () => {
  // The uploader is what fails on a missing path, so the stub has to fail the
  // way it does — a stub that always succeeds tests nothing.
  const missing = await run('/send', join(HOME, 'does-not-exist.txt'), {
    lang: 'en',
    sendFile: async () => { throw new Error('ENOENT: no such file'); },
  });
  assert.equal(missing.claimed, true);
  assert.match(missing.text, /ENOENT/);
  // And without a file argument at all it explains the form.
  const bare = await run('/send', '', { lang: 'en' });
  assert.equal(bare.text, t('en', 'ctrl.send.usage'));
});
