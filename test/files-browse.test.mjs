// `/ls` and `/view`: looking around a topic folder from a phone.
//
// The two commands have to answer three questions honestly: what is in this
// folder, what happens when the path is not there, and what a card does when the
// folder changed under it. None of that needs Telegram or a running bridge.
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LIST_CAP, listDir, listingCard } from '../chat/file-listing.mjs';
import { handleFileCommands } from '../control/cmd-files.mjs';

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'listing-'));
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

/** A command context that records what the reply was. */
function ctx(root, effective, arg, lang = 'en') {
  const box = { text: '', keyboard: [] };
  return {
    box,
    effective,
    arg,
    lang,
    key: 'CHAT:TOPIC',
    state: { cwd: { 'CHAT:TOPIC': root } },
    reply: async (text, extra) => {
      box.text = text;
      box.keyboard = extra?.keyboard || [];
    },
  };
}

test('folder first, then files, alphabetically, without the noise', () => {
  const root = tree({ 'a.txt': 'a', 'z.md': 'z', 'src/x.mjs': 'x', 'node_modules/p/index.js': 'p' });
  const result = listDir(root, '.');
  assert.deepEqual(result.rows.map((row) => `${row.name}${row.dir ? '/' : ''}`), ['src/', 'a.txt', 'z.md']);
  assert.equal(result.dirs, 1);
  assert.equal(result.files, 2);
});

test('a subfolder is listed by the path that names it', () => {
  const root = tree({ 'src/deep/x.mjs': 'x', 'src/y.mjs': 'y' });
  const result = listDir(root, 'src');
  assert.deepEqual(result.rows.map((row) => row.name), ['deep', 'y.mjs']);
});

test('outside the topic, missing, and a file where a folder was expected', () => {
  const root = tree({ 'a.txt': 'a' });
  assert.equal(listDir(root, '..').refusal, 'outside');
  assert.equal(listDir(root, 'nope').refusal, 'missing');
  assert.equal(listDir(root, 'a.txt').refusal, 'notDir');
});

test('the card says what the folder holds and how much of it is shown', () => {
  const root = tree({ 'a.txt': 'a', 'src/x.mjs': 'x' });
  const card = listingCard('.', listDir(root, '.'), 'en');
  assert.match(card.text, /2 folders|folders/);
  assert.match(card.text, /\b1 folders\b|\b1 folder/);
  assert.equal(card.keyboard.length, 2);
  assert.equal(card.keyboard[0][0].text, 'src/');
});

test('a big folder is capped and says how many rows it hid', () => {
  const files = {};
  for (let n = 0; n < LIST_CAP + 5; n += 1) files[`f${String(n).padStart(3, '0')}.txt`] = 'x';
  const root = tree(files);
  const card = listingCard('.', listDir(root, '.'), 'en');
  assert.equal(card.keyboard.length, LIST_CAP);
  assert.match(card.text, new RegExp(`${LIST_CAP + 5}`));
});

test('every row carries a row number, never a path that could outgrow 64 bytes', () => {
  const root = tree({ 'a.txt': 'a' });
  const card = listingCard('.', listDir(root, '.'), 'en');
  for (const row of card.keyboard.flat()) {
    assert.match(row.data, /^fv:\d+$/);
    assert.ok(row.data.length <= 64);
  }
});

test('/view: line numbers, and a path that names its own line', async () => {
  const body = Array.from({ length: 200 }, (_, n) => `line ${n + 1}`).join('\n');
  const root = tree({ 'app.mjs': body });
  const called = ctx(root, '/view', 'app.mjs:120');
  assert.equal(await handleFileCommands(called), true);
  assert.match(called.box.text, /120 line 120/);
  assert.match(called.box.text, /lines/);
});

test('/view accepts a space before the line number too', async () => {
  const body = Array.from({ length: 60 }, (_, n) => `row ${n + 1}`).join('\n');
  const root = tree({ 'app.mjs': body });
  const called = ctx(root, '/view', 'app.mjs 42');
  await handleFileCommands(called);
  assert.match(called.box.text, /42 row 42/);
});

test('/view without a path explains itself instead of doing nothing', async () => {
  const root = tree({ 'a.txt': 'a' });
  const called = ctx(root, '/view', '');
  assert.equal(await handleFileCommands(called), true);
  assert.match(called.box.text, /\/view/);
});

test('/ls on a file opens the file rather than refusing', async () => {
  const root = tree({ 'notes.md': 'one\ntwo\n' });
  const called = ctx(root, '/ls', 'notes.md');
  await handleFileCommands(called);
  assert.match(called.box.text, /notes\.md/);
  assert.match(called.box.text, /two/);
});

test('/ls outside the topic folder is a refusal that names the root', async () => {
  const root = tree({ 'a.txt': 'a' });
  const called = ctx(root, '/ls', '../../etc');
  await handleFileCommands(called);
  assert.match(called.box.text, /outside/);
});

test('the listing is remembered so a card can still answer its press', async () => {
  const root = tree({ 'src/x.mjs': 'x' });
  const called = ctx(root, '/ls', '');
  await handleFileCommands(called);
  assert.equal(called.state.listing['CHAT:TOPIC'].rows[0].name, 'src');
});

test('another command is not this module’s to answer', async () => {
  const root = tree({ 'a.txt': 'a' });
  assert.equal(await handleFileCommands(ctx(root, '/status', '')), false);
});

test('a topic with no folder is told so, not searched', async () => {
  const called = ctx('', '/ls', '');
  called.state.cwd = {};
  await handleFileCommands(called);
  assert.match(called.box.text, /\/cd/);
});
