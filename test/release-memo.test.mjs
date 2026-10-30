// One question, one answer.
//
// `/update` and `/version` are the same card — `/version` is rewritten to
// `/update` before dispatch — and CI caught them disagreeing: on a slow runner
// the first `npm view` answered and the second one timed out, so two spellings
// of one command reported different versions of the same fact. The fix is a
// one-minute memo in `npmLatest`, and this file pins it, because the failure it
// prevents is invisible on a fast machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { npmLatest } from '../control/release.mjs';

test('the same package asked twice in one minute answers the same', () => {
  const first = npmLatest('dsh-tg-bridge');
  const started = Date.now();
  const second = npmLatest('dsh-tg-bridge');
  assert.equal(second, first, 'two calls in one process must not disagree');
  // The second call is a map lookup, not a second npm invocation. 200ms is a
  // generous ceiling for that and still far below any real `npm view`.
  assert.ok(Date.now() - started < 200, `the second call took ${Date.now() - started}ms`);
});

test('the answer is a version or an honest empty string, never junk', () => {
  const value = npmLatest('dsh-tg-bridge');
  assert.ok(value === '' || /^\d+\.\d+\.\d+/.test(value), `unexpected answer: ${JSON.stringify(value)}`);
});
