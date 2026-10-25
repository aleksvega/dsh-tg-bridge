import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressPanel } from '../panel.mjs';

test('a quiet turn is a single status line with no empty block', () => {
  const { html, plain } = progressPanel({ lang: 'ru', seconds: 7 });
  assert.equal(html, '⏳ Работаю… 7 с');
  assert.equal(plain, html);
  assert.doesNotMatch(html, /blockquote/);
});

test('reasoning becomes one collapsed native block, escaped', () => {
  const { html } = progressPanel({
    lang: 'ru',
    seconds: 12,
    thinking: 'Смотрю <script> и & "кавычки"',
    steps: ['bash: npm test'],
  });
  assert.match(html, /<blockquote expandable>🧠 Размышления\nСмотрю &lt;script&gt; и &amp; "кавычки"<\/blockquote>/);
  assert.match(html, /• bash: npm test/);
  // Exactly one collapsible block: the chat stays one line while the turn runs.
  assert.equal(html.match(/<blockquote/g).length, 1);
});

test('the final panel keeps the reasoning and says the turn is done', () => {
  const { html } = progressPanel({
    lang: 'en', seconds: 61, final: true, thinking: 'done thinking', cache: '🧠 cache: 50% (12k from cache)',
  });
  assert.match(html, /^✅ Done · 61 s/);
  assert.match(html, /blockquote expandable/);
  assert.match(html, /cache: 50%/);
});

test('long reasoning keeps its tail and admits the head is hidden', () => {
  const thinking = `${'a'.repeat(5000)}TAIL-MARKER`;
  const { html, plain } = progressPanel({ lang: 'ru', thinking });
  assert.match(html, /начало скрыто/);
  assert.match(html, /TAIL-MARKER/);
  assert.ok(html.includes('a'.repeat(2000)), 'the kept tail must stay long');
  assert.ok(!html.includes('a'.repeat(2410)), 'the head must be cut, not the tail');
  assert.ok(html.length <= 3900, `panel too long: ${html.length}`);
  assert.match(plain, /Размышления · начало скрыто/);
});

test('a panel with many steps and thoughts still fits one Telegram message', () => {
  const { html } = progressPanel({
    lang: 'zh',
    seconds: 3600,
    final: true,
    steps: Array.from({ length: 40 }, (_, i) => `bash: command-${i}-${'x'.repeat(48)}`),
    thoughts: ['длинная мысль '.repeat(20), 'ещё одна '.repeat(20)],
    thinking: '推理'.repeat(3000),
    cache: '🧠 缓存：42%（21k 来自缓存）',
  });
  assert.ok(html.length <= 3900, `panel too long: ${html.length}`);
  assert.match(html, /…还有 37 条/);
});

test('every language labels the block in its own words', () => {
  for (const [lang, label] of [['en', 'Reasoning'], ['ru', 'Размышления'], ['zh', '推理']]) {
    const { html } = progressPanel({ lang, thinking: 'x' });
    assert.match(html, new RegExp(`🧠 ${label}`));
  }
});

test('the plain twin carries the same reasoning without any markup', () => {
  const { html, plain } = progressPanel({
    lang: 'en', thinking: 'a <b> and c', steps: ['edit: file.mjs'], thoughts: ['decided X'],
  });
  assert.match(html, /&lt;b&gt;/);
  assert.doesNotMatch(plain, /<blockquote/);
  assert.match(plain, /a <b> and c/);
  assert.match(plain, /🧠 Reasoning\na <b> and c/);
});
