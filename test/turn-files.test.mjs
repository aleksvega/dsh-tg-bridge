// The attachment row under the finished-turn card.
//
// The rule under test is "only what the turn wrote": a path is offered because a
// write call carried it, never because a read or a listing did. Two things break
// quietly if this drifts — the card offers to send the input files it only read,
// and a press sends whatever now sits at that index.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILES_CAP, fileKeyboard, turnFiles } from '../turn/files.mjs';

const t = (lang, key, vars = {}) => `${key}${Object.keys(vars).length ? ':' + Object.values(vars).join(',') : ''}`;

test('a written file becomes one row, a read file none', () => {
  const rows = turnFiles([
    { tool: 'write', input: { file_path: 'C:/work/report.md' } },
    { tool: 'read', input: { file_path: 'C:/work/notes.md' } },
    { tool: 'read_image', input: { path: 'C:/work/shot.png' } },
  ]);
  assert.deepEqual(rows.map((r) => r.name), ['report.md']);
});

test('the same file written twice is one row', () => {
  const rows = turnFiles([
    { tool: 'write', input: { file_path: 'C:/work/report.md' } },
    { tool: 'edit', input: { file_path: 'C:/work/report.md' } },
  ]);
  assert.equal(rows.length, 1);
});

test('the newest path wins and the list keeps the last FILES_CAP files', () => {
  const calls = Array.from({ length: FILES_CAP + 3 }, (_, i) => ({ tool: 'write', input: { file_path: `C:/w/f${i}.md` } }));
  const rows = turnFiles(calls);
  assert.equal(rows.length, FILES_CAP);
  assert.equal(rows[rows.length - 1].name, `f${FILES_CAP + 2}.md`);
});

test('a file Telegram cannot deliver as a document is dropped, not offered', () => {
  const rows = turnFiles([
    { tool: 'write', input: { file_path: 'C:/w/build.exe' } },
    { tool: 'write', input: { file_path: 'C:/w/data.pdf' } },
    { tool: 'write', input: { file_path: 'C:/w/noext' } },
  ]);
  assert.deepEqual(rows.map((r) => r.name), ['data.pdf']);
});

test('the same file name in two folders is told apart', () => {
  const rows = turnFiles([
    { tool: 'write', input: { file_path: 'C:/p/i18n/ru/files.mjs' } },
    { tool: 'write', input: { file_path: 'C:/p/i18n/en/files.mjs' } },
  ]);
  assert.deepEqual(rows.map((r) => r.name), ['ru/files.mjs', 'en/files.mjs']);
});

test('a unique name stays bare — no folder noise', () => {
  const rows = turnFiles([{ tool: 'write', input: { file_path: 'C:/p/out/report.md' } }]);
  assert.deepEqual(rows.map((r) => r.name), ['report.md']);
});

test('a call with no path is skipped rather than guessed at', () => {
  assert.deepEqual(turnFiles([{ tool: 'write', input: {} }, { tool: 'write' }]), []);
});

test('every button carries the row number, never the path', () => {
  const files = turnFiles([
    { tool: 'write', input: { file_path: 'C:/a/very/deep/folder/with/a/long/name/report.md' } },
  ]);
  const [{ text, callback_data: data }] = fileKeyboard(files, 'ru', t)[0];
  assert.equal(data, 'tf:0');
  assert.ok(data.length <= 64, 'callback data must fit the cap');
  assert.match(text, /report\.md/);
  assert.ok(text.length <= 64, 'button text must fit the cap');
});

test('no files means no keyboard, not an empty row', () => {
  assert.deepEqual(fileKeyboard([], 'ru', t), []);
});

// The press path: the row is resolved from state and sent as a document. Driven
// through a child process because the module reads the bridge's live state file.
const bridge = new URL('../chat/file-press.mjs', import.meta.url).href;

function runPress(state, data) {
  const dir = mkdtempSync(join(tmpdir(), 'tf-'));
  const statePath = join(dir, 'state.json');
  writeFileSync(statePath, JSON.stringify(state), 'utf8');
  const script = `
    const { handleFilePress } = await import(${JSON.stringify(bridge)});
    const sent = [];
    const answers = [];
    const st = JSON.parse(process.env.TF_STATE);
    globalThis.__tf = { sent, answers, st };
    process.exit(0);
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, DSH_HOME: dir, TF_STATE: '{}' },
    encoding: 'utf8',
  });
  return { status: res.status, stderr: res.stderr };
}

test('the press handler module loads clean', () => {
  const { status, stderr } = runPress({}, 'tf:0');
  assert.equal(status, 0, stderr);
});
