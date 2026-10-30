import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progressPanel, stepLine, addStep } from '../chat/panel.mjs';

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
    final: true,
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
  const { html, plain } = progressPanel({ lang: 'ru', final: true, thinking });
  assert.match(html, /начало скрыто/);
  assert.match(html, /TAIL-MARKER/);
  assert.ok(html.includes('a'.repeat(1500)), 'the kept tail must stay long');
  assert.ok(!html.includes('a'.repeat(2010)), 'the head must be cut, not the tail');
  assert.ok(html.length <= 3900, `panel too long: ${html.length}`);
  assert.match(plain, /Размышления · начало скрыто/);
  // A cut block points at the command that still has the whole text.
  assert.match(plain, /начало скрыто · \/thoughts/);
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
  // Both the reasoning and the whole step list are collapsed blocks; a long turn
  // never grows the chat past this one message.
  assert.equal(html.match(/<blockquote expandable>/g).length, 2);
  assert.match(html, /🛠 步骤 · 40 · 前文已省略/);
  assert.match(html, /command-39-/);
  assert.doesNotMatch(html.split('<blockquote')[0], /• /, 'steps live in the block, not inline');
});

test('a set chip rides in the head and stays inside the budget', () => {
  const plain = progressPanel({ lang: 'en', seconds: 7, task: 'do the thing' });
  assert.doesNotMatch(plain.html, /Reviewer/);
  const chipped = progressPanel({ lang: 'en', seconds: 7, task: 'do the thing', chip: 'Reviewer · glm-5.3/high · read-only' });
  assert.match(chipped.html.split('\n')[0], /Reviewer · glm-5\.3\/high · read-only/);
  const done = progressPanel({ lang: 'en', seconds: 9, final: true, chip: 'Fast' });
  assert.match(done.html.split('\n')[0], /^✅ .* · 9 s · Fast$/);

  const big = progressPanel({
    lang: 'en',
    seconds: 3600,
    final: true,
    steps: Array.from({ length: 60 }, (_, i) => `bash: command-${i}-${'x'.repeat(48)}`),
    thinking: 'reasoning '.repeat(20000),
    chip: 'Reviewer · glm-5.3/high',
  });
  assert.ok(big.html.length <= 3900, `panel with a chip too long: ${big.html.length}`);
  assert.match(big.html, /Reviewer/);
});

test('a short turn keeps its three steps inline, without a second block', () => {
  const { html } = progressPanel({ lang: 'en', steps: ['bash: a', 'edit: b', 'read: c'] });
  assert.match(html, /• bash: a\n• edit: b\n• read: c/);
  assert.doesNotMatch(html, /Steps/);
});

test('every language labels the block in its own words', () => {
  for (const [lang, label] of [['en', 'Reasoning'], ['ru', 'Размышления'], ['zh', '推理']]) {
    const { html } = progressPanel({ lang, final: true, thinking: 'x' });
    assert.match(html, new RegExp(`🧠 ${label}`));
  }
});

test('the plain twin carries the same reasoning without any markup', () => {
  const { html, plain } = progressPanel({
    lang: 'en', final: true, thinking: 'a <b> and c', steps: ['edit: file.mjs'], thoughts: ['decided X'],
  });
  assert.match(html, /&lt;b&gt;/);
  assert.doesNotMatch(plain, /<blockquote/);
  assert.match(plain, /a <b> and c/);
  assert.match(plain, /🧠 Reasoning\na <b> and c/);
});

test('a step line names the work, not the shell plumbing', () => {
  assert.equal(
    stepLine({ tool: 'pwsh', input: { command: "cd 'C:\\work\\repo'\nnode sync-runtime.mjs" } }),
    'pwsh: node sync-runtime.mjs',
  );
  assert.equal(stepLine({ tool: 'pwsh', input: { command: "cd 'x' && npm test" } }), 'pwsh: npm test');
  assert.equal(stepLine({ tool: 'pwsh', input: { command: "cd 'C:\\very\\long\\path'" } }), '', 'a bare cd is not a step');
  assert.equal(stepLine({ tool: 'read', input: { file_path: 'C:\\p\\bridge.mjs' } }), 'read: C:\\p\\bridge.mjs');
  assert.equal(stepLine({ tool: 'pwsh', input: { command: 'x'.repeat(200) } }).length, 'pwsh: '.length + 64);
});

test('repeated steps fold into one line with a count', () => {
  const steps = [];
  for (const line of ['pwsh: npm test', 'pwsh: npm test', 'pwsh: npm test', 'read: a.mjs']) addStep(steps, line);
  addStep(steps, 'pwsh: npm test');
  assert.deepEqual(steps, ['pwsh: npm test ×3', 'read: a.mjs', 'pwsh: npm test']);
  addStep(steps, '');
  assert.equal(steps.length, 3, 'an empty line is skipped, not pushed');
});

test('a live edit carries no collapsible block, only the last steps', () => {
  // Telegram drops an expanded block on every edit of its message, so a message
  // that is still being rewritten must not hold one: the reasoning is a counter
  // until the turn ends, and the steps stay inline.
  const steps = Array.from({ length: 40 }, (_, i) => `bash: command-${i}`);
  const { html } = progressPanel({ lang: 'ru', final: false, steps, thinking: 'x'.repeat(900) });
  assert.doesNotMatch(html, /blockquote/, 'no block while the message is live');
  assert.match(html, /🧠 Размышления · 900/);
  assert.match(html, /• bash: command-39/);
  assert.match(html, /ещё 37/);
  assert.ok(html.length <= 3900);
});

test('the final edit is the only one with blocks, and it has both', () => {
  const steps = Array.from({ length: 40 }, (_, i) => `bash: command-${i}`);
  const { html } = progressPanel({ lang: 'ru', final: true, steps, thinking: 'x'.repeat(900) });
  assert.equal(html.match(/<blockquote expandable>/g).length, 2);
  assert.doesNotMatch(html, /Размышления · 900/);
});

test('counter mode keeps the reasoning out of the chat entirely', () => {
  const { html, plain } = progressPanel({
    lang: 'ru', final: true, reasoning: 'counter', thinking: 'x'.repeat(700),
    steps: ['a', 'b', 'c', 'd'],
  });
  // The steps keep their own block; the reasoning does not get one.
  assert.equal(html.match(/<blockquote/g).length, 1);
  assert.doesNotMatch(html, /🧠 Размышления\n/);
  assert.match(html, /🧠 Размышления · 700 · \/thoughts file/);
  assert.match(plain, /^✅/m);
});

test('the live head echoes the request, so the first message names the task', () => {
  const { html } = progressPanel({ lang: 'en', seconds: 2, task: 'fix the split  of long   answers' });
  assert.match(html, /^⏳ On it: «fix the split of long answers» · 2 s/m);
});

test('a long request is shortened with an ellipsis, and the final head drops it', () => {
  const task = 'x'.repeat(80);
  const live = progressPanel({ lang: 'en', seconds: 1, task }).html;
  assert.match(live, /«x{48}…»/);
  const final = progressPanel({ lang: 'en', seconds: 9, final: true, task }).html;
  assert.doesNotMatch(final, /x{10}/);
});
