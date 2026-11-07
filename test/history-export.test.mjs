import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatHistory, writeHistory } from '../work/history.mjs';

const dir = mkdtempSync(join(tmpdir(), 'history-'));

test('every turn becomes a numbered block with labels', () => {
  const out = formatHistory(
    [
      { turn: 1, user: 'собери отчёт', answer: 'готово' },
      { turn: 2, user: '', answer: 'продолжаю' },
      { turn: 3, user: '', answer: '' },
    ],
    { title: 'История · сессия ab12 · 3 ход(ов)', turn: 'Ход', user: 'Пользователь', answer: 'Ответ', silent: '— без текста' },
  );
  assert.ok(out.includes('# История · сессия ab12 · 3 ход(ов)'));
  assert.ok(out.includes('## Ход 1'));
  assert.ok(out.includes('**Пользователь**'));
  assert.ok(out.includes('собери отчёт'));
  assert.ok(out.includes('**Ответ**'));
  assert.ok(out.includes('_— без текста_'));
  // A turn without user text must not print an empty label line.
  const second = out.split('## Ход 2')[1];
  assert.ok(!second.includes('**Пользователь**'), 'a turn with no user text still prints the label');
});

test('a thousand turns make one writable file, not a message', () => {
  const turns = Array.from({ length: 1000 }, (_, i) => ({ turn: i + 1, user: `вопрос ${i}`, answer: `ответ ${i}` }));
  const out = formatHistory(turns, { title: 't', turn: 'Turn', user: 'User', answer: 'Answer', silent: '—' });
  assert.ok(out.includes('## Turn 1000'));
  assert.ok(out.endsWith('\n'));
});

test('writeHistory lands under the reports dir and never collides', () => {
  const at = new Date('2026-11-07T19:24:00Z');
  const first = writeHistory('one', join(dir, 'reports'), at);
  const second = writeHistory('two', join(dir, 'reports'), new Date('2026-11-07T19:24:01Z'));
  assert.ok(first && second);
  assert.notEqual(first, second);
  assert.equal(readFileSync(first, 'utf8'), 'one');
  rmSync(join(dir, 'reports'), { recursive: true, force: true });
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
