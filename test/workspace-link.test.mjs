// A Telegram session must appear under its folder in the desktop sidebar.
//
// The sidebar groups by `workspace.json` → `tables.workspaces[<id>].sessionIds`,
// and a headless turn never writes there: the session works, then shows up as
// "Ungrouped". These tests pin the rules that make the bridge's own list safe.
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { linkSession, pickWorkspace } from '../turn/workspace-link.mjs';

const ROOT = process.platform === 'win32' ? 'C:\\work' : '/work';

/** A store shaped like the real one, with one workspace per given path. */
function store(paths, extra = {}) {
  const workspaces = {};
  paths.forEach((path, index) => {
    workspaces[`w${index}`] = { id: `w${index}`, path, sessionIds: [], ...(extra[path] || {}) };
  });
  return { unit: '1', global: {}, tables: { workspaces } };
}

function writeStore(data) {
  const dir = mkdtempSync(join(tmpdir(), 'ws-'));
  const file = join(dir, 'workspace.json');
  writeFileSync(file, JSON.stringify(data), 'utf8');
  return file;
}

test('the workspace whose path is the turn folder takes the session', () => {
  const file = writeStore(store([ROOT, `${ROOT}\\other`]));
  assert.equal(linkSession({ sessionId: 'session-1', cwd: ROOT, file }), 'linked');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(saved.tables.workspaces.w0.sessionIds, ['session-1']);
  assert.deepEqual(saved.tables.workspaces.w1.sessionIds, []);
});

test('a session already named anywhere is left alone', () => {
  const data = store([ROOT], { [ROOT]: { sessionIds: ['session-1'] } });
  const file = writeStore(data);
  assert.equal(linkSession({ sessionId: 'session-1', cwd: ROOT, file }), 'present');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(saved.tables.workspaces.w0.sessionIds, ['session-1']);
});

test('the only workspace claims a folder nobody matched, several do not', () => {
  const only = writeStore(store([ROOT]));
  assert.equal(linkSession({ sessionId: 'session-2', cwd: '/elsewhere', file: only }), 'linked');
  const many = writeStore(store([ROOT, `${ROOT}\\b`]));
  assert.equal(linkSession({ sessionId: 'session-3', cwd: '/elsewhere', file: many }), 'no-workspace');
});

test('a missing or broken store is a refusal, never a rewrite', () => {
  assert.equal(linkSession({ sessionId: 's', cwd: ROOT, file: join(tmpdir(), 'nope', 'workspace.json') }), 'no-store');
  const dir = mkdtempSync(join(tmpdir(), 'ws-'));
  const bad = join(dir, 'workspace.json');
  writeFileSync(bad, '{not json', 'utf8');
  assert.equal(linkSession({ sessionId: 's', cwd: ROOT, file: bad }), 'bad-store');
  assert.equal(readFileSync(bad, 'utf8'), '{not json');
});

test('the write keeps every other field of the store', () => {
  const data = store([ROOT]);
  data.tables.projects = { p1: { name: 'keep me' } };
  const file = writeStore(data);
  linkSession({ sessionId: 'session-9', cwd: ROOT, file });
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(saved.tables.projects, { p1: { name: 'keep me' } });
  assert.equal(saved.unit, '1');
});

test('pickWorkspace answers by path, and refuses when two paths match', () => {
  const one = store([ROOT]).tables.workspaces;
  assert.equal(pickWorkspace(one, ROOT).id, 'w0');
  const twin = { a: { path: ROOT, sessionIds: [] }, b: { path: ROOT, sessionIds: [] } };
  assert.equal(pickWorkspace(twin, ROOT), null);
});
