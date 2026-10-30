import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlbumBuffer } from '../chat/albums.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Timing on Windows is coarse (timer resolution is about 15 ms), so every test
// keeps a wide margin between the quiet window and the gaps it actually sleeps.

test('items of one album arrive as a single batch, in order', async () => {
  const flushed = [];
  // The window is deliberately wider than the gaps between the pushes. It used to
  // be 60 ms against 10 ms gaps, which passed until the machine was busy: one
  // stalled tick and the first item flushed alone, failing a test about ordering
  // because of the clock rather than the code.
  const buffer = createAlbumBuffer({ quietMs: 200, maxMs: 2000, onFlush: (items, key) => flushed.push([key, items]) });
  buffer.push('chat:1', 'a');
  await sleep(10);
  buffer.push('chat:1', 'b');
  await sleep(10);
  buffer.push('chat:1', 'c');
  assert.equal(buffer.pending(), 1);
  await sleep(600);
  assert.equal(buffer.pending(), 0);
  assert.deepEqual(flushed, [['chat:1', ['a', 'b', 'c']]]);
});

test('different albums flush separately', async () => {
  const flushed = [];
  const buffer = createAlbumBuffer({ quietMs: 40, maxMs: 600, onFlush: (items, key) => flushed.push([key, items]) });
  buffer.push('chat:1', 'x');
  buffer.push('chat:2', 'y');
  await sleep(200);
  assert.deepEqual(flushed, [['chat:1', ['x']], ['chat:2', ['y']]]);
});

test('the ceiling cuts off an upload that keeps trickling', async () => {
  const order = [];
  const flushes = [];
  const buffer = createAlbumBuffer({ quietMs: 500, maxMs: 80, onFlush: (items) => { flushes.push(items.length); order.push(...items); } });
  const pushed = [];
  for (let i = 0; i < 8; i += 1) {
    pushed.push(i);
    buffer.push('k', i);
    await sleep(25);
  }
  await sleep(600);
  // The ceiling let the first items go while the upload was still running, and
  // every item is delivered exactly once, in order, even across those batches.
  assert.ok(flushes.length >= 2, `expected the ceiling to split the album, got ${flushes.length} batch(es)`);
  assert.deepEqual(order, pushed);
});

test('a single item still flushes', async () => {
  const flushed = [];
  const buffer = createAlbumBuffer({ quietMs: 40, maxMs: 600, onFlush: (items) => flushed.push(items) });
  buffer.push('k', 'one');
  await sleep(200);
  assert.deepEqual(flushed, [['one']]);
});
