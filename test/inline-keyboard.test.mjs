/**
 * Guard: every keyboard the bot draws is in the shape Telegram accepts.
 *
 * A card builds its buttons as `{ text, data }` — a payload, not a Telegram
 * field. Telegram wants `callback_data` and rejects the entire message with
 * "Text buttons are not allowed in the inline keyboard" when it meets `data`.
 * Every send wrapped its API call in `.catch(() => {})`, so `/menu`, `/settings`
 * and the task card silently drew nothing for several releases: no error in the
 * log, no buttons in the chat.
 *
 * These tests hold both ends: the conversion at the transport edge, and the
 * cards' own promise that a press is a payload somebody can answer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, t } from '../core/i18n.mjs';
import { renderPanel, MENU_GROUPS } from '../chat/menu-card.mjs';
import { SETTINGS_PAGES, renderSettingsCard, settingsCurrent } from '../profile/settings-card.mjs';
import { inlineKeyboard, sendWithMarkup } from '../chat/telegram.mjs';

const tr = (lang) => (key, vars) => t(lang, key, vars);
const flat = (rows) => (Array.isArray(rows) ? rows.flat() : []);

/** What Telegram itself checks: a button is either a payload or a link. */
function telegramAcceptable(rows) {
  for (const row of rows) {
    assert.ok(Array.isArray(row), 'a row of buttons is an array');
    assert.ok(row.length > 0, 'an empty row is rejected by Telegram');
    for (const button of row) {
      assert.equal(typeof button.text, 'string', 'every button has a label');
      assert.ok(button.text.length > 0 && button.text.length <= 64, `label length: ${button.text}`);
      const payload = button.callback_data ?? button.url;
      assert.notEqual(payload, undefined, `button "${button.text}" has no payload and no link`);
      assert.equal(button.data, undefined, `button "${button.text}" still carries a raw "data" field`);
      if (button.callback_data !== undefined) {
        assert.ok(Buffer.byteLength(button.callback_data) <= 64, `payload too long: ${button.callback_data}`);
      }
    }
  }
}

test('the transport turns { text, data } into callback_data', () => {
  const rows = inlineKeyboard([[{ text: 'on', data: 'm:reasoning:on' }, { text: 'off', data: 'm:reasoning:off' }]]);
  assert.deepEqual(rows, [[{ text: 'on', callback_data: 'm:reasoning:on' }, { text: 'off', callback_data: 'm:reasoning:off' }]]);
});

test('the transport leaves a finished button alone', () => {
  const rows = inlineKeyboard([[{ text: 'site', url: 'https://example.com' }, { text: 'ok', callback_data: 'ok' }]]);
  assert.deepEqual(rows, [[{ text: 'site', url: 'https://example.com' }, { text: 'ok', callback_data: 'ok' }]]);
});

test('a button with no payload is dropped, not sent', () => {
  // Telegram rejects the whole message for one such button, so the cost of
  // keeping it is the card, not the button.
  const rows = inlineKeyboard([[{ text: 'label only' }, { text: 'real', data: 'x' }]]);
  assert.deepEqual(rows, [[{ text: 'real', callback_data: 'x' }]]);
  assert.deepEqual(inlineKeyboard([[{ text: 'label only' }]]), []);
});

test('every page of the panel survives the transport in all three languages', () => {
  for (const lang of LANGS) {
    for (const page of ['', ...MENU_GROUPS]) {
      const card = renderPanel({ t: tr(lang), page });
      const rows = inlineKeyboard(card.keyboard);
      assert.ok(rows.length > 0, `${lang}/${page || 'hub'} lost every button`);
      telegramAcceptable(rows);
      // And the press still means something to the router.
      for (const button of flat(rows)) assert.match(button.callback_data, /^mn:/, `${lang}/${page}: ${button.callback_data}`);
    }
  }
});

test('every page of the settings card survives the transport', () => {
  const current = settingsCurrent({ config: {}, state: {}, key: '1:2' });
  for (const lang of LANGS) {
    for (const page of SETTINGS_PAGES) {
      const card = renderSettingsCard({ page, t: tr(lang), current, updateMode: 'check' });
      const rows = inlineKeyboard(card.keyboard);
      assert.ok(rows.length > 0, `${lang}/${page} lost every button`);
      telegramAcceptable(rows);
      for (const button of flat(rows)) assert.match(button.callback_data, /^m:/, `${lang}/${page}: ${button.callback_data}`);
    }
  }
});

test('the cards keep their own vocabulary — the conversion lives at the edge', () => {
  // If the cards started emitting callback_data themselves, the transport rule
  // above would stop being the single place that knows Telegram's field name.
  const panel = renderPanel({ t: tr('en') });
  for (const button of flat(panel.keyboard)) {
    assert.equal(button.callback_data, undefined);
    assert.equal(typeof button.data, 'string');
  }
});

/** Capture what the transport puts on the wire, then put fetch back. */
async function wire(run) {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push({ method: String(url).split('/').pop(), body: JSON.parse(init.body) });
    return { json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
  }
  return sent;
}

test('a card that hands its buttons over as reply_markup still gets buttons', async () => {
  // The second way a keyboard went missing. `/load` (control/cmd-load.mjs), the
  // held-turn notice (work/load-guard.mjs) and the sandbox notice
  // (chat/handle-message.mjs) all pass `{ reply_markup: { inline_keyboard } }`,
  // and `sendWithMarkup` read only `extra.keyboard`, so the key was ignored and
  // each of those messages left without buttons: a card whose whole point is its
  // two buttons, and a notice telling a person to open /permissions with a button
  // that was never drawn.
  const sent = await wire(() => sendWithMarkup(1, 7, 'load', {
    reply_markup: { inline_keyboard: [[{ text: 'refresh', data: 'ld:r' }]] },
  }));
  assert.equal(sent.length, 1, 'one message, no retry');
  assert.equal(sent[0].method, 'sendMessage');
  assert.equal(sent[0].body.message_thread_id, 7, 'and it stays in its topic');
  assert.deepEqual(sent[0].body.reply_markup.inline_keyboard, [[{ text: 'refresh', callback_data: 'ld:r' }]]);
  telegramAcceptable(sent[0].body.reply_markup.inline_keyboard);
});

test('a finished button handed over as reply_markup passes through untouched', async () => {
  const sent = await wire(() => sendWithMarkup(1, 7, 'notice', {
    reply_markup: { inline_keyboard: [[{ text: 'permissions', callback_data: 'mn:permissions' }]] },
  }));
  assert.deepEqual(sent[0].body.reply_markup.inline_keyboard, [[{ text: 'permissions', callback_data: 'mn:permissions' }]]);
});

test('a keyboard with nothing pressable is reported, not sent empty', async () => {
  const sent = await wire(() => sendWithMarkup(1, 7, 'guard', {
    reply_markup: { inline_keyboard: [[{ text: 'label only' }]] },
  }));
  assert.equal(sent.length, 1, 'the text still arrives');
  assert.equal(sent[0].body.reply_markup, undefined, 'and it arrives without an empty keyboard');
});
