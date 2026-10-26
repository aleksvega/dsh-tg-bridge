import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentsetStore, builtinSets, emptySet, slugId } from '../agentsets.mjs';

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'aset-'));
  return { dir, file: join(dir, 'agentsets.json') };
}

test('a corrupt agentsets.json falls back to builtins and never throws', () => {
  const { file } = scratch();
  writeFileSync(file, '{]', 'utf8');
  const store = new AgentsetStore(file).load();
  assert.equal(store.error.includes('unreadable'), true);
  assert.equal(Object.keys(store.sets).length, Object.keys(builtinSets()).length);
  assert.equal(store.get('careful').builtin, true);
});

test('a missing file starts from the builtins without writing anything', () => {
  const { file } = scratch();
  const store = new AgentsetStore(file).load();
  assert.equal(store.error, '');
  assert.equal(store.list()[0].builtin, true);
  assert.equal(existsSync(file), false);
});

test('a save re-reads rev and refuses a stale write, keeping the first edit', () => {
  const { file } = scratch();
  const first = new AgentsetStore(file).load();
  first.put({ ...emptySet('mine', 'Mine') });
  assert.equal(first.save().ok, true);

  const second = new AgentsetStore(file).load();
  const third = new AgentsetStore(file).load();
  assert.equal(second.put({ ...emptySet('second', 'Second') }).ok, true);
  const lost = third.put({ ...emptySet('third', 'Third') });
  assert.equal(lost.ok, false);
  assert.equal(lost.error, 'stale');

  const reread = new AgentsetStore(file).load();
  assert.equal(reread.get('second').name, 'Second');
  assert.equal(reread.get('third'), null);
});

test('unknown fields survive a read-modify-write', () => {
  const { file } = scratch();
  const seed = { version: 1, rev: 1, sets: { ...builtinSets(), custom: { ...emptySet('custom'), future: { nested: 1 } } }, trash: [] };
  writeFileSync(file, JSON.stringify(seed), 'utf8');
  const store = new AgentsetStore(file).load();
  store.put({ ...store.get('custom'), model: 'deepseek-v4.1-flash' });
  const after = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(after.sets.custom.future, { nested: 1 });
  assert.equal(after.sets.custom.model, 'deepseek-v4.1-flash');
});

test('a builtin is read-only, and deleting a set keeps it in trash within the cap', () => {
  const { file } = scratch();
  const store = new AgentsetStore(file).load();
  assert.equal(store.put({ ...emptySet('reviewer', 'Renamed') }).error, 'builtin-readonly');
  assert.equal(store.remove('reviewer').error, 'builtin-readonly');

  store.put({ ...emptySet('throwaway', 'Throwaway') });
  assert.equal(store.remove('throwaway').ok, true);
  assert.equal(store.get('throwaway'), null);
  assert.deepEqual(store.trashList(), ['throwaway']);
  assert.equal(store.restore('throwaway').id, 'throwaway');
  assert.equal(store.get('throwaway').name, 'Throwaway');
  assert.deepEqual(store.trashList(), []);
});

test('the trash drops entries older than the ttl', () => {
  const { file } = scratch();
  const old = { set: { ...emptySet('ancient', 'Ancient') }, deletedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 };
  writeFileSync(file, JSON.stringify({ version: 1, rev: 2, sets: builtinSets(), trash: [old] }), 'utf8');
  const store = new AgentsetStore(file).load();
  assert.deepEqual(store.trashList(), []);
});

test('slugId accepts what the id rule accepts and nothing else', () => {
  assert.equal(slugId('My Set'), 'my-set');
  assert.equal(slugId('  Reviewer #2 '), 'reviewer-2');
  assert.equal(slugId('кириллица'), '');
  assert.equal(slugId(''), '');
  assert.equal(slugId('a'.repeat(40)).length, 24);
  assert.equal(new AgentsetStore('x').put({ id: 'Bad Id' }).error, 'bad-id');
});
