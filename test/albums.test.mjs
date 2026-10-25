import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlbumBuffer } from '../albums.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('items of one album arrive as a single batch, in order', async () => {
  const flushed = [];
  const buffer = createAlbumBuffer({ quietMs: 20, maxMs: 200, onFlush: (items, key) => flushed.push([key, items]) });
  buffer.push('chat:1', 'a');
  await sleep(5);
  buffer.push('chat:1', 'b');
  await sleep(5);
  buffer.push('chat:1', 'c');
  assert.equal(buffer.pending(), 1);
  await sleep(60);
  assert.equal(buffer.pending(), 0);
  assert.deepEqual(flushed, [['chat:1', ['a', 'b', 'c']]]);
});

test('different albums flush separately', async () => {
  const flushed = [];
  const buffer = createAlbumBuffer({ quietMs: 15, maxMs: 200, onFlush: (items, key) => flushed.push([key, items]) });
  buffer.push('chat:1', 'x');
  buffer.push('chat:2', 'y');
  await sleep(50);
  assert.deepEqual(flushed, [['chat:1', ['x']], ['chat:2', ['y']]]);
});

test('the ceiling cuts off an upload that keeps trickling', async () => {
  const flushed = [];
  const buffer = createAlbumBuffer({ quietMs: 40, maxMs: 60, onFlush: (items) => flushed.push(items) });
  buffer.push('k', 1);
  await sleep(25);
  buffer.push('k', 2);
  await sleep(25);
  buffer.push('k', 3);
  await sleep(40);
  assert.deepEqual(flushed, [[1, 2, 3]]);
});

test('a single item still flushes', async () => {
  const flushed = [];
  const buffer = createAlbumBuffer({ quietMs: 10, maxMs: 100, onFlush: (items) => flushed.push(items) });
  buffer.push('k', 'one');
  await sleep(40);
  assert.deepEqual(flushed, [['one']]);
});
