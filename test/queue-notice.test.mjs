import test from 'node:test';
import assert from 'node:assert/strict';
import { noticeIsObsolete } from '../turn/queue-notice.mjs';

test('the same running turn keeps its notice', () => {
  assert.equal(noticeIsObsolete(100, 100, true), false);
});

test('a drained queue makes the notice obsolete', () => {
  assert.equal(noticeIsObsolete(100, 100, false), true);
});

test('the queued turn starting while the notice is in flight makes it obsolete', () => {
  assert.equal(noticeIsObsolete(100, 200, true), true);
});

test('a turn that appeared after queueing makes the notice obsolete', () => {
  assert.equal(noticeIsObsolete(undefined, 200, true), true);
});
