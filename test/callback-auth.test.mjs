import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The router moved to `callbacks.mjs`; the guard is asserted where it lives now.
const source = readFileSync(new URL('../callbacks.mjs', import.meta.url), 'utf8');

/** The body of handleCallback, so assertions cannot match the message path. */
function callbackBody() {
  const start = source.indexOf('async function handleCallback(query)');
  assert.ok(start > 0, 'handleCallback not found');
  const end = source.indexOf('\n}\n', start);
  return source.slice(start, end);
}

test('handleCallback refuses a press from a user outside the allowlist', () => {
  const body = callbackBody();
  assert.match(body, /const presser = query\.from\?\.id;/, 'reads the pressing user');
  assert.match(
    body,
    /if \(!config\.allowedUserIds\.includes\(presser\) && !config\.allowedUserIds\.includes\(chatId\)\) \{/,
    'checks the allowlist before acting',
  );
  assert.match(body, /await answer\(t\(lang, 'bridge\.cb\.unknown'\)\);\s*\n\s*return;/, 'answers and stops');
});

test('the allowlist check runs before any keyboard edit or state write', () => {
  const body = callbackBody();
  const guard = body.indexOf('const presser =');
  const edit = body.indexOf('const clearKeyboard =');
  const stop = body.indexOf("if (data === 'stop')");
  assert.ok(guard > 0 && edit > guard, 'guard precedes the first keyboard edit');
  assert.ok(stop > guard, 'guard precedes the first action');
  assert.ok(!/saveState\(\)/.test(body.slice(0, guard)), 'nothing is persisted before the guard');
});

test('no callback branch mutates configuration without the guard in front of it', () => {
  const body = callbackBody();
  const guard = body.indexOf('const presser =');
  const stateful = [...body.matchAll(/^\s*(state\.|saveState\()/gm)].map((m) => m.index);
  for (const at of stateful) assert.ok(at > guard, 'a state write sits above the guard');
});
