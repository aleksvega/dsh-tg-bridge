// A press that finds nothing to do must still answer.
//
// The report that started this was not "the card is wrong" but "nothing happens
// at all", and the code had several ways to produce exactly that: a stale
// payload returned after a silently swallowed toast, a handler that threw before
// answering, a card that redrawn itself into an identical message. None of them
// wrote a log line, so from the outside a broken button and a working button on
// a quiet day looked the same.
//
// These tests hold the two halves of the answer: the guard notices silence on
// its own (test/quiet-guard.test.mjs), and every press path reports what it did.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-press-'));
process.env.DSH_HOME = HOME;
writeFileSync(join(HOME, 'state.json'), JSON.stringify({ allowedUserIds: [42], lang: 'ru' }), 'utf8');

const { handleCardPress } = await import('../settings-press.mjs');
const { boundSetOf } = await import('../settings-press.mjs');
const { commandFor, renderSettingsCard } = await import('../settings-card.mjs');

const ctx = (over = {}) => {
  const seen = [];
  return {
    seen,
    value: {
      chatId: 42,
      messageId: 7,
      threadId: 0,
      key: '42:0',
      lang: 'ru',
      answer: (text, show = false) => {
        seen.push({ text, show });
        return Promise.resolve(true);
      },
      mark: () => seen.push({ mark: true }),
      ...over,
    },
  };
};

const press = (data) => ({ id: 'q1', data, message: { chat: { id: 42 }, message_id: 7, message_thread_id: 0 }, from: { id: 42 } });

test('a button from an older card answers with an alert instead of nothing', async () => {
  const { value, seen } = ctx();
  await handleCardPress(press('m:no-such-row'), value);
  assert.equal(seen.length, 1, 'exactly one answer, no silent return');
  assert.match(seen[0].text, /старой версии/i);
  assert.equal(seen[0].show, true, 'a dead card is worth stopping on, not a toast that fades');
});

test('the set bound to a topic is read, not remembered', () => {
  // No binding in this state: the card must say "nothing bound", and it must not
  // throw when the store file is absent — a render that throws is a press that
  // never answers.
  assert.equal(boundSetOf('42:0'), null);
});

test('a tab press names its page, so the redraw is not the page already shown', () => {
  // The bug this pins: `{ tab }` without `page` made the press redraw `reply`
  // whatever tab was pressed. Telegram answered "message is not modified" and the
  // menu looked dead — for every tab, on every card, with nothing in the log.
  const current = { reasoning: 'card', reasoningAll: 'card', pin: 'off', model: 'unorouter/x', effort: 'high' };
  const t = (key, vars) => (vars ? `${key}:${Object.values(vars).join(',')}` : key);

  for (const page of ['reply', 'agent', 'updates', 'health']) {
    const wanted = commandFor({ t, current, updateMode: 'check' }, `m:${page}`);
    assert.equal(wanted.tab, page);
    assert.equal(wanted.page, page, `tab ${page} must carry its page`);
  }

  const shown = renderSettingsCard({ page: 'reply', t, current, updateMode: 'check' });
  for (const page of ['agent', 'updates', 'health']) {
    const wanted = commandFor({ t, current, updateMode: 'check' }, `m:${page}`);
    const next = renderSettingsCard({ page: wanted.page, t, current, updateMode: 'check' });
    assert.notEqual(next.text, shown.text, `pressing ${page} must change the message, or Telegram refuses the edit`);
  }
});
