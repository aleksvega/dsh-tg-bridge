import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSteerJob } from '../steer-queue.mjs';

test('writes one json job and leaves no temp file behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'steer-'));
  const job = writeSteerJob(dir, { sessionId: 's', text: 'привет', chatId: 1, threadId: 2, lang: 'ru', say: 'x' });
  assert.deepEqual(readdirSync(dir), [`${job.id}.json`]);
  const back = JSON.parse(readFileSync(join(dir, `${job.id}.json`), 'utf8'));
  assert.equal(back.text, 'привет');
  assert.equal(back.threadId, 2);
  assert.equal(back.chatId, 1);
  assert.equal(back.id, job.id);
  assert.ok(back.at > 0);
});

test('ids do not collide within the same millisecond', () => {
  const dir = mkdtempSync(join(tmpdir(), 'steer-'));
  const ids = new Set(Array.from({ length: 50 }, () => writeSteerJob(dir, { text: 'x' }).id));
  assert.equal(ids.size, 50);
});

test('a caller-supplied id is kept', () => {
  const dir = mkdtempSync(join(tmpdir(), 'steer-'));
  const job = writeSteerJob(dir, { id: 'fixed-id', text: 'x' });
  assert.equal(job.id, 'fixed-id');
  assert.ok(readdirSync(dir).includes('fixed-id.json'));
});
