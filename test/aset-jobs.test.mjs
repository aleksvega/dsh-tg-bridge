// `/agentset` from a running turn arrives as a job file, and the callback
// buttons are built from the same schema: a payload that cannot be parsed must
// never reach a write.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drainAsetJobs, asetJobDir } from '../aset-jobs.mjs';
import { callbackData, cardKeyboard, parseCallback } from '../aset-schema.mjs';

test('a job is applied once, then moves to done', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asetjobs-'));
  const done = join(dir, 'aset-jobs', 'done');
  mkdirSync(done, { recursive: true });
  writeFileSync(join(asetJobDir(dir), '01.json'), JSON.stringify({ chatId: 1, action: 'use', id: 'fast' }));
  const seen = [];
  const results = drainAsetJobs(dir, (job) => {
    seen.push(job);
    return { ok: true, text: `bound ${job.id}`, changed: true };
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].text, 'bound fast');
  assert.equal(results[0].changed, true);
  assert.equal(seen.length, 1);
  assert.equal(existsSync(join(done, '01.json')), true);
  assert.equal(readdirSync(asetJobDir(dir)).filter((n) => n.endsWith('.json')).length, 0);
  // A second drain finds nothing, so a job cannot be applied twice.
  assert.deepEqual(drainAsetJobs(dir, () => ({ ok: true, text: 'again' })), []);
});

test('a broken job is dropped, and a throwing apply cannot stop the queue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asetjobs-'));
  const done = join(dir, 'aset-jobs', 'done');
  mkdirSync(done, { recursive: true });
  writeFileSync(join(asetJobDir(dir), '01-broken.json'), '{not json');
  writeFileSync(join(asetJobDir(dir), '02-throws.json'), JSON.stringify({ chatId: 2 }));
  const results = drainAsetJobs(dir, () => { throw new Error('store unreadable'); });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.match(results[0].text, /unreadable/);
  assert.equal(results[0].changed, false);
  assert.deepEqual(readdirSync(asetJobDir(dir)).filter((n) => n.endsWith('.json')), []);
});

test('a missing job directory is not an error', () => {
  assert.deepEqual(drainAsetJobs(mkdtempSync(join(tmpdir(), 'asetnone-')), () => ({})), []);
});

test('callback data round-trips and every payload fits 64 bytes', () => {
  assert.deepEqual(parseCallback('as:use:feast'), { verb: 'use', id: 'feast', slot: '' });
  assert.deepEqual(parseCallback('as:edit:feast:model'), { verb: 'edit', id: 'feast', slot: 'model' });
  assert.deepEqual(parseCallback('as:off:'), { verb: 'off', id: '', slot: '' });
  assert.equal(parseCallback('as:use'), null, 'a verb without an id is refused');
  assert.equal(parseCallback('as:use:Bad Id'), null);
  assert.equal(parseCallback('as:delete:feast'), null);
  assert.equal(parseCallback('model:big'), null);
  const long = callbackData('edit', 'a'.repeat(24), 'permissions');
  assert.ok(long.length <= 64, `payload too long: ${long.length}`);

  const card = cardKeyboard({ id: 'feast' }, { bound: true, slots: ['Model|model', 'Effort|effort', 'Permissions|permissions'] });
  assert.ok(card.flat().every((button) => button.data.length <= 64));
  assert.ok(card.flat().some((button) => button.data === 'as:off:feast'));
  // The label is what a person reads; the payload stays ASCII, so a Chinese or
  // Russian label cannot change which field a press means.
  assert.ok(card.flat().some((button) => button.text === 'Model' && button.data === 'as:edit:feast:model'));
});

test('a builtin set gets no write buttons', () => {
  const card = cardKeyboard({ id: 'careful' }, { builtin: true, slots: ['Model|model'] });
  const data = card.flat().map((button) => button.data);
  assert.deepEqual(data, ['as:show:careful']);
});