// The context meter: the number that stops a turn from hitting the wall.
//
// A turn that runs into its model's context window dies expensively — the prompt
// is re-sent, billed, and rejected — and `/status` could only tell the person
// afterwards. The meter answers the same question while the turn runs, and its
// whole value is that it refuses to guess: a percentage of an unknown
// denominator is worse than silence, because it reads as a measurement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contextFill, contextRow, contextUsed, shortTokens, WARN_PCT, FULL_PCT } from '../turn/context-meter.mjs';
import { progressPanel } from '../chat/panel.mjs';
import { t } from '../core/i18n.mjs';

test('a fill is a fraction of the window, with a level', () => {
  assert.deepEqual(contextFill({ used: 500_000, limit: 1_000_000 }), {
    used: 500_000, limit: 1_000_000, pct: 50, level: 'ok',
  });
  assert.equal(contextFill({ used: WARN_PCT * 10_000, limit: 1_000_000 }).level, 'warn');
  assert.equal(contextFill({ used: FULL_PCT * 10_000, limit: 1_000_000 }).level, 'full');
  // Over the window is still 100 %, not 117 %: the turn is already lost, and a
  // number above the ceiling reads as a broken meter rather than a broken turn.
  assert.equal(contextFill({ used: 1_200_000, limit: 1_000_000 }).pct, 100);
});

test('no usage or no window means no number at all', () => {
  // The two ways to be ignorant. Both must be silence, not a guess.
  assert.equal(contextFill({ used: 0, limit: 1_000_000 }), null);
  assert.equal(contextFill({ used: 5000, limit: 0 }), null);
  assert.equal(contextFill({}), null);
  assert.equal(contextFill(), null);
  assert.equal(contextFill({ used: NaN, limit: 1000 }), null);
  // And the row is empty, so a card that has nothing to say says nothing.
  assert.equal(contextRow({ used: 5000, limit: 0 }, 'ru'), '');
});

test('the context is the prompt, not the lifetime total', () => {
  // `totalTokens` is the provider's own sum and wins when present.
  assert.equal(contextUsed({ totalTokens: 900_000, inputTokens: 1, cacheReadTokens: 2 }), 900_000);
  // Older providers report the parts only: adding them is the same number.
  assert.equal(contextUsed({ inputTokens: 300_000, cacheReadTokens: 600_000 }), 900_000);
  // The answer being written is not in the window yet, so it is not counted.
  assert.equal(contextUsed({ inputTokens: 100, outputTokens: 50_000 }), 100);
  assert.equal(contextUsed({}), 0);
  assert.equal(contextUsed(), 0);
});

test('a token count is short enough for a one-line card', () => {
  assert.equal(shortTokens(950), '950');
  assert.equal(shortTokens(812_400), '812k');
  assert.equal(shortTokens(1_000_000), '1M');
  assert.equal(shortTokens(1_048_576), '1M');
  assert.equal(shortTokens(485_000), '485k');
  assert.equal(shortTokens(-5), '?');
  assert.equal(shortTokens('nonsense'), '?');
});

test('every language says how full the context is, and says when it matters', () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const ok = contextRow({ used: 200_000, limit: 1_000_000 }, lang);
    const warn = contextRow({ used: 800_000, limit: 1_000_000 }, lang);
    const full = contextRow({ used: 950_000, limit: 1_000_000 }, lang);
    for (const [name, row] of [['ok', ok], ['warn', warn], ['full', full]]) {
      assert.ok(row.length > 0, `${lang} ${name} said nothing`);
      // A translated row that lost a variable is the failure this catches.
      assert.doesNotMatch(row, /\{\w+\}/, `${lang} ${name} left a placeholder: ${row}`);
      assert.match(row, /200k|800k|950k/, `${lang} ${name} lost the count: ${row}`);
      assert.match(row, /1M/, `${lang} ${name} lost the window: ${row}`);
    }
    // Warn and full must be distinguishable from "fine" — otherwise the row is
    // decoration and nobody acts on it.
    assert.notEqual(warn, ok, `${lang} warn looks like ok`);
    assert.notEqual(full, ok, `${lang} full looks like ok`);
    assert.notEqual(full, warn, `${lang} full looks like warn`);
  }
});

test('the card shows the meter only when it has something to say', () => {
  const base = { lang: 'en', seconds: 12, final: true };
  // Final: the number is always there, which is how it is learned for free.
  const withCtx = progressPanel({ ...base, context: '📊 context 812k / 1M (81%)' });
  assert.match(withCtx.plain, /812k/);
  // No meter: the card is the card it always was, with no empty row.
  const without = progressPanel({ ...base, context: '' });
  assert.doesNotMatch(without.plain, /📊/);
  // The same row reaches the HTML path, escaped like everything else.
  assert.match(withCtx.html, /context 812k/);
});

test('a live card carries the meter once it matters, and the final card always', () => {
  // The policy lives in `progress.mjs`; this is the half of it the renderer owns:
  // given a row, it appears in both the live and the final card.
  const live = progressPanel({ lang: 'ru', seconds: 40, context: contextRow({ used: 800_000, limit: 1_000_000 }, 'ru') });
  assert.match(live.plain, /800k/);
  const final = progressPanel({ lang: 'ru', seconds: 40, final: true, context: contextRow({ used: 100_000, limit: 1_000_000 }, 'ru') });
  assert.match(final.plain, /100k/);
});

test('the strings the meter asks for exist in every language', () => {
  for (const lang of ['en', 'ru', 'zh']) {
    for (const key of ['status.contextRow', 'status.contextWarn', 'status.contextFull']) {
      const text = t(lang, key, { used: '1k', limit: '2k', pct: 50 });
      assert.ok(text && text !== key, `${lang} is missing ${key}`);
      assert.match(text, /1k/, `${lang} ${key} dropped {used}`);
      assert.match(text, /50/, `${lang} ${key} dropped {pct}`);
    }
  }
});

test('the final card can carry what the turn cost, and says nothing without a price', () => {
  const base = { lang: 'en', seconds: 30, final: true };
  const paid = progressPanel({ ...base, money: '💰 this turn: $0.0042' });
  assert.match(paid.plain, /\$0\.0042/);
  // No price cache means no line: an empty string is not a zero-dollar receipt.
  const free = progressPanel({ ...base, money: '' });
  assert.doesNotMatch(free.plain, /\$0/, 'a card with no price claimed a free turn');
  // A live card never shows money: there is no final bill while the turn runs.
  const live = progressPanel({ lang: 'en', seconds: 5, money: '💰 this turn: $0.0042' });
  assert.match(live.plain, /0\.0042/, 'the row itself renders whenever it is given');
});
