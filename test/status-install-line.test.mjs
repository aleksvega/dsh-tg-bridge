// The status card printed "UI: desktop (wikivibe/deepseek-v4.1-flash) — plugins
// 22" four lines under "Profile: headless (unorouter/...)". Both facts were true
// and both were about the install, so the card read as if this topic answered on
// a desktop route -- the question it raised in the chat was exactly that. The
// card is per topic; the desktop app has no business in it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { t } from '../core/i18n.mjs';

const SRC = readFileSync(new URL('../control/cmd-views.mjs', import.meta.url), 'utf8');

test('the status card counts the plugins of the profile the topic uses', () => {
  assert.doesNotMatch(SRC, /modelOf\('desktop'\)/, 'a per-topic card must not read the desktop profile');
  assert.match(SRC, /pluginsOf\(activeProfile\)/, 'the count has to come from the topic profile');
});

test('the line names the topic profile, in all three languages', () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const line = t(lang, 'ctrl.status.ui', { profile: 'headless', n: 3 });
    assert.match(line, /headless/, `${lang} does not name the profile`);
    assert.match(line, /3/, `${lang} does not print the count`);
    assert.doesNotMatch(line, /desktop/i, `${lang} still names the desktop app`);
  }
});