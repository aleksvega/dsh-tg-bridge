/**
 * The settings card is a door, and a door has to open.
 *
 * The row «Модель» runs `/model`, whose answer is a card with buttons. The press
 * handler used to keep only the text of whatever the command answered, so the
 * model card arrived as a plain message: it named the current model and offered
 * no way to change it. That is the shape of the bug this file guards.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-settings-'));
process.env.DSH_HOME = HOME;

const PROFILE = 'headless';
const PATCH = `- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      acme:
        displayName: Unorouter
        baseURL: https://api.acme-llm.test/v1
        models:
          - id: deepseek-v4.1-flash
            name: deepseek-v4.1-flash
      wikivibe:
        displayName: Wikivibe
        baseURL: https://api.wikivibe.example/v1
        models:
          - id: kimi-k3
            name: kimi-k3
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: acme
    model: deepseek-v4.1-flash
`;
mkdirSync(join(HOME, 'profiles', PROFILE), { recursive: true });
writeFileSync(join(HOME, 'profiles', PROFILE, 'cordis.patch.yml'), PATCH, 'utf8');

const { handleCardPress } = await import('../profile/settings-press.mjs');

// Placeholders, not a real chat: a test that carries someone's chat id is a
// secret leak that also passes every day.
const CHAT = 555000111;
const TOPIC = 555000222;

/** Run a press with fetch captured, the way the bridge would. */
async function press(data) {
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    sent.push({ method: String(url).split('/').pop(), body });
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 1 } }) };
  };
  try {
    await handleCardPress(
      { id: 'q1', data },
      {
        chatId: CHAT,
        messageId: 55,
        threadId: TOPIC,
        key: `${CHAT}:${TOPIC}`,
        lang: 'en',
        answer: async () => {},
      },
    );
  } finally {
    globalThis.fetch = realFetch;
  }
  return sent;
}

test('the model row of the settings card sends a card you can press', async () => {
  const sent = await press('m:model');
  // Only new messages: the settings card itself is redrawn in place, and its own
  // keyboard is not the answer this test is about.
  const messages = sent.filter((call) => call.method === 'sendMessage');
  const card = messages.find((call) =>
    (call.body?.reply_markup?.inline_keyboard || [])
      .flat()
      .some((button) => String(button.callback_data || '').startsWith('md:')));
  assert.ok(card, 'no message carried model buttons: the door opened onto a wall');
  assert.equal(card.body.message_thread_id, TOPIC, 'the card left the topic it was asked in');
});

test('a switch row still answers in place, without a second message', async () => {
  // The fix must not turn every settings switch into a card: a toggle redraws the
  // card it was pressed on, and its own answer is text at most.
  const sent = await press('m:thoughts');
  const withButtons = sent.filter(
    (call) => call.method === 'sendMessage' && call.body?.reply_markup?.inline_keyboard?.length > 0,
  );
  assert.deepEqual(withButtons, [], 'a toggle started sending cards');
});