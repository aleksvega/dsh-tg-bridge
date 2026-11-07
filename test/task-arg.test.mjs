import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { condenseTask, TASK_ARG_LIMIT } from '../turn/task-arg.mjs';

test('a task under the limit stays on the command line', () => {
  const { text, file } = condenseTask('перечисли файлы', (p) => `READ ${p}`);
  assert.equal(text, 'перечисли файлы');
  assert.equal(file, '');
});

test('a task past the limit moves to a file and leaves a pointer', () => {
  const task = 'x'.repeat(TASK_ARG_LIMIT + 1);
  const { text, file } = condenseTask(task, (p) => `READ ${p}`);
  assert.ok(file, 'no file was written');
  assert.equal(readFileSync(file, 'utf8'), task, 'the file must hold the whole task');
  assert.equal(text, `READ ${file}`);
  assert.ok(text.length < 300, `the pointer is ${text.length} chars`);
  rmSync(file);
});

test('a non-string task passes through untouched', () => {
  assert.deepEqual(condenseTask(undefined, (p) => `READ ${p}`), { text: undefined, file: '' });
});

test('the limit itself leaves headroom under the Windows ceiling', () => {
  // 32 767 is the whole command line; the task shares it with the launcher
  // flags, profile and session id, and every argument is quoted with room to
  // spare. 24 000 keeps all of that inside.
  assert.ok(TASK_ARG_LIMIT < 30_000);
  assert.ok(TASK_ARG_LIMIT >= 20_000);
});
