// "Почему так долго" needs a number: the clock alone cannot tell a slow provider
// from a turn that spends its minutes in tools. The panel head now carries the
// turn's average generation speed, computed from the usage the harness reports on
// status events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { progressPanel } from '../chat/panel.mjs';
import { t } from '../core/i18n.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// The panel and its token bookkeeping moved to `progress.mjs`; the assertions
// follow the code instead of being dropped.
const source = readFileSync(join(here, '..', 'turn', 'progress.mjs'), 'utf8');

test('the speed is shown next to the clock, in the topic language', () => {
  const ru = progressPanel({ lang: 'ru', seconds: 42, final: false, speed: 37 });
  assert.match(ru.plain, /42 с · 37 т\/с/);
  const en = progressPanel({ lang: 'en', seconds: 42, final: true, speed: 37 });
  assert.match(en.plain, /42 s · 37 tok\/s/);
});

test('no measurement means no number, not a zero', () => {
  const bare = progressPanel({ lang: 'ru', seconds: 5, final: false, speed: 0 });
  assert.doesNotMatch(bare.plain, /т\/с/);
  assert.doesNotMatch(progressPanel({ lang: 'ru', seconds: 5 }).plain, /т\/с/);
});

test('the bridge tracks output tokens and never divides by a fraction of a second', () => {
  assert.match(source, /outputTokens: 0, outputTotal: 0 \}/, 'usage must start at zero, with a running total');
  assert.match(source, /usage\.outputTotal \+= event\.usage\.outputTokens/, 'per-step tokens must be summed, not overwritten');
  assert.match(source, /event\.usage\.outputTokens/, 'the status event carries it');
  assert.match(source, /speedOf\(usage\.outputTotal/, 'the speed uses the running total');
  const helper = source.slice(source.indexOf('function speedOf'), source.indexOf('function speedOf') + 500);
  assert.match(helper, /ms < 3000/, 'a three-second turn is not a measurement');
  assert.match(helper, /outputTokens \/ \(ms \/ 1000\)/);
});

test('the unit exists in every language', () => {
  for (const lang of ['en', 'ru', 'zh']) {
    assert.ok(t(lang, 'status.speed'), `${lang} needs status.speed`);
  }
});
