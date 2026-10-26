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

test('a save rebases one concurrent write instead of losing the edit', () => {
  const { file } = scratch();
  const first = new AgentsetStore(file).load();
  first.put({ ...emptySet('mine', 'Mine') });
  assert.equal(first.save().ok, true);

  const second = new AgentsetStore(file).load();
  const third = new AgentsetStore(file).load();
  assert.equal(second.put({ ...emptySet('second', 'Second') }).ok, true);
  // `third` still holds rev 1; its edit lands on top of `second` rather than failing.
  const rebased = third.put({ ...emptySet('third', 'Third') });
  assert.equal(rebased.ok, true);

  const reread = new AgentsetStore(file).load();
  assert.equal(reread.get('second').name, 'Second');
  assert.equal(reread.get('third').name, 'Third');
  assert.equal(reread.get('mine').name, 'Mine');
  assert.equal(reread.data.rev, 4);
});

test('a handle that rebases does not resurrect a set somebody else deleted', () => {
  const { file } = scratch();
  const one = new AgentsetStore(file).load();
  one.put({ ...emptySet('mine', 'Mine') });
  one.save();
  const user = new AgentsetStore(file).load();
  const other = new AgentsetStore(file).load();
  assert.equal(user.remove('mine').ok, true);
  // `other` never saw the delete: its own edit must not bring `mine` back.
  other.put({ ...emptySet('other', 'Other') });
  assert.equal(other.save().ok, true);
  const reread = new AgentsetStore(file).load();
  assert.equal(reread.get('mine'), null);
  assert.equal(reread.get('other').name, 'Other');
});

test('an unreadable file during the rebase fails loudly instead of clobbering it', () => {
  const { file } = scratch();
  const one = new AgentsetStore(file).load();
  one.put({ ...emptySet('mine', 'Mine') });
  one.save();
  const loser = new AgentsetStore(file).load();
  loser.put({ ...emptySet('lost', 'Lost') });
  writeFileSync(file, '{"rev": 9, "sets": ', 'utf8');
  const result = loser.save();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unreadable');
  assert.match(readFileSync(file, 'utf8'), /^\{"rev": 9/, 'the broken file is left alone');
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
