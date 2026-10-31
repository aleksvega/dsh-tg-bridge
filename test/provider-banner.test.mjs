// The vendor's error page must never reach the chat as if it were the answer.
//
// Reported from a live topic: a 570-second gateway limit came back as the
// assistant's own message — `[req_e00194ab] [deepseek-v4.1-flash] **Request
// exceeded 570s limit** … **Recommended tools:** — these responses are
// optimized for opencode, [CC] and Codex`. The turn exited 0, so the bridge
// logged it as `ok`, posted the wall of text, and never walked the fallback
// chain: nothing had failed as far as the pipeline could tell.
import test from 'node:test';
import assert from 'node:assert/strict';

import { bannerError, providerBanner } from '../turn/provider-banner.mjs';
import { turnOutcome } from '../turn/turn-outcome.mjs';
import { explainFailure } from '../turn/failures.mjs';
import { failureFamily } from '../model/fallback.mjs';

/** The real text, trimmed to the parts that matter, with CRLF kept. */
const LIVE = [
  '[req_e00194ab] [deepseek-v4.1-flash]',
  '**Request exceeded 570s limit**',
  '- Your prompt took too long to process, likely due to a large context window or heavy reasoning required by the AI provider.',
  'How to fix:',
  '- **Send "continue"** to resume from where the model stopped (works for most timeouts).',
  '- **Start a new session/chat** to clear accumulated context and reset the timer.',
  '**Billing:**',
  '- This request still counts as a request and is billed based on its input.',
  '**Recommended tools:**',
  '- these responses are optimized for opencode, [CC] and Codex.',
].join('\r\n');

test('the live banner is recognised and gives up its request id, model and clock', () => {
  const banner = providerBanner(LIVE);
  assert.ok(banner, 'the reported text must be recognised');
  assert.equal(banner.requestId, 'req_e00194ab');
  assert.equal(banner.model, 'deepseek-v4.1-flash');
  assert.equal(banner.seconds, 570);
  assert.equal(banner.rest, '', 'nothing followed the vendor template');
});

test('a banner followed by real work keeps the work and drops the banner', () => {
  const mixed = `${LIVE}\n\nГотово: файл arcanum.py создан, 22 аркана.`;
  const banner = providerBanner(mixed);
  assert.ok(banner);
  assert.equal(banner.rest, 'Готово: файл arcanum.py создан, 22 аркана.');
});

test('a plain answer is not a banner, even when it talks about timeouts', () => {
  // The distinction the whole fix rests on: quoting an error is an answer.
  const answer = 'Провайдер вернул «Request exceeded 570s limit» — это его потолок. Предлагаю /new.';
  assert.equal(providerBanner(answer), null);
  const prose = 'Разбираю, почему запрос превысил лимит. План: 1) уменьшить контекст, 2) сменить маршрут.';
  assert.equal(providerBanner(prose), null);
});

test('a request id alone, or a limit alone, is not an error page', () => {
  assert.equal(providerBanner('[req_e00194ab] вот мой ответ по задаче'), null);
  assert.equal(providerBanner('Request exceeded 570s limit'), null, 'the vendor template is the tell');
});

test('the banner becomes an error on an exit-0 turn instead of an answer', () => {
  const out = turnOutcome({ code: 0, stopped: false, finalText: LIVE });
  assert.equal(out.text, '', 'the wall of text must not be sent');
  assert.equal(out.error, 'PROVIDER_TIMEOUT: 570');
  assert.equal(out.stopped, false);
});

test('a banner with work behind it is sent as the answer', () => {
  const out = turnOutcome({ code: 0, stopped: false, finalText: `${LIVE}\n\nГотово: 22 аркана.` });
  assert.equal(out.text, 'Готово: 22 аркана.');
  assert.equal(out.error, '');
});

test('a normal answer passes through untouched', () => {
  const out = turnOutcome({ code: 0, stopped: false, finalText: 'Готово: 22 аркана.' });
  assert.equal(out.text, 'Готово: 22 аркана.');
  assert.equal(out.error, '');
});

test('a provider timeout is its own fallback family, not a context overflow', () => {
  // The vendor page names "large context window" and "Billing", so a family
  // claimed after `context` would explain the switch with the wrong sentence.
  assert.equal(failureFamily('PROVIDER_TIMEOUT: 570'), 'timeout');
  assert.equal(failureFamily(LIVE), 'timeout');
  assert.equal(failureFamily('context length exceeded'), 'context', 'a real window error stays a window error');
});

test('the failure sentence is ours, short, and says what to do', () => {
  const said = explainFailure('PROVIDER_TIMEOUT: 570', 'ru');
  assert.match(said, /^PROVIDER_TIMEOUT: /);
  assert.match(said, /570/);
  assert.match(said, /продолжай/i);
  assert.doesNotMatch(said, /Recommended tools|opencode/, 'the vendor advert must not be echoed');
  // Every locale answers in its own words.
  assert.match(explainFailure('PROVIDER_TIMEOUT: 570', 'en'), /continue/i);
  assert.match(explainFailure('PROVIDER_TIMEOUT: 570', 'zh'), /继续/);
});

test('bannerError names the clock, and a missing one does not print a placeholder', () => {
  assert.equal(bannerError({ seconds: 570 }), 'PROVIDER_TIMEOUT: 570');
  assert.equal(bannerError(null), 'PROVIDER_TIMEOUT: ?');
});
