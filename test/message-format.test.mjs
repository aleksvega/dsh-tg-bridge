// The formatting layer had no tests, which is how a chat ended up showing
// literal `<b>` and `<code>`: the HTML was split at 3800 characters, the cut
// fell inside a `<pre><code>` block, Telegram rejected every part, and the
// fallback resent the markup as plain text. These tests pin the two halves of
// the fix: cut the markdown, never the HTML, and strip markup on the way out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownParts, toPlainText, toTelegramHtml } from '../core/format.mjs';

const fenceCount = (text) => (text.match(/^```/gm) ?? []).length;
const count = (text, needle) => text.split(needle).length - 1;

const longAnswer = [
  '## Почистить npm',
  '',
  'Пакет `dsh-tg-bridge`, 45 версий, `latest = 1.10.0`.',
  '',
  '| Когда | Что можно |',
  '|---|---|',
  '| < 72 ч | удалить версию |',
  '| > 72 ч | только при условиях |',
  '',
  '```powershell',
  '$drop = (npm view dsh-tg-bridge versions --json | ConvertFrom-Json)',
  'foreach ($v in $drop) {',
  '  npm unpublish "dsh-tg-bridge@$v"',
  '  Start-Sleep -Milliseconds 400',
  '}',
  '```',
  '',
  ...Array.from({ length: 60 }, (_, i) => `Строка ${i + 1}: <b>не тег</b>, а пример текста & мусор.`),
  '',
  'Конец.',
].join('\n');

test('markdownParts never cuts inside a fenced block', () => {
  const parts = markdownParts(longAnswer, 900);
  assert.ok(parts.length > 2, 'the sample must actually split');
  for (const part of parts) {
    assert.equal(fenceCount(part) % 2, 0, `unbalanced fence in part:\n${part.slice(0, 120)}`);
  }
});

test('every part stays under the limit and keeps the words', () => {
  const parts = markdownParts(longAnswer, 900);
  for (const part of parts) assert.ok(part.length <= 900, `part is ${part.length} chars`);
  const joined = parts.join('\n');
  assert.match(joined, /ConvertFrom-Json/);
  assert.match(joined, /Конец\./);
  assert.equal(joined.match(/Строка \d+:/g)?.length, 60);
});

test('a long listing is re-opened with its language tag on the next part', () => {
  const lines = Array.from({ length: 300 }, (_, i) => `line ${i}. npm unpublish dsh-tg-bridge@${i}.0.0 --otp=123456`);
  const parts = markdownParts(['```powershell', ...lines, '```'].join('\n'), 900);
  assert.ok(parts.length > 1);
  assert.match(parts[1], /^```powershell/, 'the new part must open a fence, not a bare body');
  assert.match(parts[0], /```$/, 'the cut part must close its fence');
});

test('toTelegramHtml leaves balanced tags on every part', () => {
  for (const part of markdownParts(longAnswer, 900)) {
    const html = toTelegramHtml(part);
    assert.equal(count(html, '<pre>'), count(html, '</pre>'));
    assert.equal(count(html, '<code'), count(html, '</code>'));
    assert.equal(count(html, '<b>'), count(html, '</b>'));
    assert.equal(count(html, '<i>'), count(html, '</i>'));
  }
});

test('the old bug: HTML cut mid-block is invalid, markdown cut is not', () => {
  const html = toTelegramHtml(longAnswer);
  assert.ok(html.length > 3800, 'the sample must be long enough to have been split');
  // A blind slice inside the listing is what Telegram rejected with
  // "Can't find end tag corresponding to start tag code".
  const blind = html.slice(0, html.indexOf('<pre>') + 20);
  assert.notEqual(count(blind, '<pre>'), count(blind, '</pre>'));
  for (const part of markdownParts(longAnswer)) {
    const piece = toTelegramHtml(part);
    assert.equal(count(piece, '<pre>'), count(piece, '</pre>'));
  }
});

test('toPlainText strips markup that leaked into the fallback', () => {
  const leaked = '<b>Готово</b> и <code>npm i</code>, порог &lt; 72 ч &amp; всё';
  assert.equal(toPlainText(leaked), 'Готово и npm i, порог < 72 ч & всё');
});

test('toPlainText turns markdown into readable text without tags', () => {
  const plain = toPlainText('**Жирный** текст и `код`, см. [доку](https://npmjs.com/x).');
  assert.equal(plain, 'Жирный текст и код, см. доку (https://npmjs.com/x).');
  assert.doesNotMatch(plain, /<[a-z/]/i);
});
