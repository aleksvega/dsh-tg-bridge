// `/edit`: three steps, one write, and an honest refusal at every seam.
//
// The tests keep to the shape the command has: name the lines, send the text,
// press apply. What they guard is that nothing reaches disk before the press,
// and that the press re-reads the file instead of trusting the preview.
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { applyEdit, cancelEdit, diffCard, handleEditCommands, parseTarget, takeEditText } from '../control/cmd-edit.mjs';

const KEY = 'CHAT:TOPIC';

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'edit-'));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(root, name), body);
  return root;
}

function ctx(root, command, arg, text = '') {
  const box = { text: '', keyboard: null };
  const st = { cwd: { [KEY]: root }, edit: {} };
  return {
    box,
    state: st,
    saveState: () => true,
    command,
    arg,
    text,
    key: KEY,
    lang: 'en',
    answer: async (out) => { box.answered = out; },
    settle: async (out) => { box.text = out; },
    reply: async (out, extra = {}) => {
      box.text = out;
      box.keyboard = extra.keyboard || null;
    },
  };
}

test('a target names a line, a range, or nothing at all', () => {
  assert.deepEqual(parseTarget('app.mjs:12'), { file: 'app.mjs', from: 12, to: 12 });
  assert.deepEqual(parseTarget('app.mjs:12-14'), { file: 'app.mjs', from: 12, to: 14 });
  assert.deepEqual(parseTarget('app.mjs 12-14'), { file: 'app.mjs', from: 12, to: 14 });
  assert.equal(parseTarget('app.mjs').error, 'lines');
  assert.equal(parseTarget('').error, 'usage');
  assert.equal(parseTarget('app.mjs:9-4').error, 'range');
});

test('/edit shows the lines and asks for the replacement', async () => {
  const root = tree({ 'app.mjs': 'one\ntwo\nthree\n' });
  const called = ctx(root, '/edit', 'app.mjs:2');
  assert.equal(await handleEditCommands(called), true);
  assert.match(called.box.text, /lines 2–2/);
  assert.match(called.box.text, /two/);
  assert.equal(called.state.edit[KEY].step, 'text');
});

test('the replacement becomes a diff, and nothing is written yet', async () => {
  const root = tree({ 'app.mjs': 'one\ntwo\nthree\n' });
  const called = ctx(root, '/edit', 'app.mjs:2');
  await handleEditCommands(called);
  called.text = 'TWO';
  assert.equal(await takeEditText(called), true);
  assert.match(called.box.text, /- two/);
  assert.match(called.box.text, /\+ TWO/);
  assert.equal(called.state.edit[KEY].step, 'confirm');
  assert.equal(readFileSync(join(root, 'app.mjs'), 'utf8'), 'one\ntwo\nthree\n');
});

test('apply writes the lines the diff showed', async () => {
  const root = tree({ 'app.mjs': 'one\ntwo\nthree\n' });
  const called = ctx(root, '/edit', 'app.mjs:2');
  await handleEditCommands(called);
  called.text = 'TWO';
  await takeEditText(called);
  await applyEdit(called);
  assert.equal(readFileSync(join(root, 'app.mjs'), 'utf8'), 'one\nTWO\nthree\n');
  assert.equal(called.state.edit[KEY], undefined);
});

test('a dash deletes the lines instead of writing a dash', async () => {
  const root = tree({ 'app.mjs': 'one\ntwo\nthree\n' });
  const called = ctx(root, '/edit', 'app.mjs:2');
  await handleEditCommands(called);
  called.text = '-';
  await takeEditText(called);
  await applyEdit(called);
  assert.equal(readFileSync(join(root, 'app.mjs'), 'utf8'), 'one\nthree\n');
});

test('a multi-line replacement replaces a range', async () => {
  const root = tree({ 'app.mjs': 'a\nb\nc\nd\n' });
  const called = ctx(root, '/edit', 'app.mjs:2-3');
  await handleEditCommands(called);
  called.text = 'B1\nB2\nB3';
  await takeEditText(called);
  await applyEdit(called);
  assert.equal(readFileSync(join(root, 'app.mjs'), 'utf8'), 'a\nB1\nB2\nB3\nd\n');
});

test('the file changed between preview and press: nothing is overwritten', async () => {
  const root = tree({ 'app.mjs': 'one\ntwo\nthree\n' });
  const called = ctx(root, '/edit', 'app.mjs:2');
  await handleEditCommands(called);
  called.text = 'TWO';
  await takeEditText(called);
  // The agent, or another turn, edited the same line after the diff was shown.
  writeFileSync(join(root, 'app.mjs'), 'one\nAGENT\nthree\n');
  await applyEdit(called);
  assert.equal(readFileSync(join(root, 'app.mjs'), 'utf8'), 'one\nAGENT\nthree\n');
  assert.match(called.box.answered, /changed/i);
});

test('a stale press answers instead of writing', async () => {
  const called = ctx(tree({ 'app.mjs': 'x\n' }), '/edit', 'app.mjs:1');
  await applyEdit(called);
  assert.match(called.box.answered, /no longer waiting|stale/i);
});

test('cancel forgets the edit and leaves the file alone', async () => {
  const root = tree({ 'app.mjs': 'one\ntwo\n' });
  const called = ctx(root, '/edit', 'app.mjs:1');
  await handleEditCommands(called);
  await cancelEdit(called);
  assert.equal(called.state.edit[KEY], undefined);
  assert.equal(readFileSync(join(root, 'app.mjs'), 'utf8'), 'one\ntwo\n');
});

test('a range past the end is refused with the real length', async () => {
  const called = ctx(tree({ 'app.mjs': 'one\ntwo\n' }), '/edit', 'app.mjs:5-9');
  await handleEditCommands(called);
  assert.match(called.box.text, /2 lines/);
  assert.equal(called.state.edit[KEY], undefined);
});

test('outside the topic folder is a refusal that names the root', async () => {
  const called = ctx(tree({}), '/edit', '../../../etc/passwd:1');
  await handleEditCommands(called);
  assert.match(called.box.text, /outside|outside the folder/i);
  assert.equal(called.state.edit[KEY], undefined);
});

test('a topic with no folder is told so', async () => {
  const called = ctx('', '/edit', 'app.mjs:1');
  await handleEditCommands(called);
  assert.match(called.box.text, /\/cd/);
});

test('a replacement that is not this module’s is left to the turn', async () => {
  const called = ctx(tree({}), '/edit', 'app.mjs:1');
  // No pending edit: the message is a prompt, and must stay one.
  assert.equal(await takeEditText(called), false);
});

test('another command is not this module’s to answer', async () => {
  const called = ctx(tree({}), '/view', 'app.mjs');
  assert.equal(await handleEditCommands(called), false);
});

test('the diff card carries exactly the two buttons a write needs', () => {
  const card = diffCard('app.mjs', 3, ['old'], ['new'], 'en');
  assert.deepEqual(card.keyboard.flat().map((b) => b.data), ['ed:a', 'ed:c']);
  assert.ok(card.keyboard.flat().every((b) => Buffer.byteLength(b.data) <= 64));
});