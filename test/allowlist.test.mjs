// A bot that answers a stranger leaks the owner's work, and a stranger who can
// steer a running turn can put instructions inside it. The allowlist used to be
// checked inside handleMessage, which the steer branch never reaches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './sandbox-home.mjs';
import { allowedSender } from '../allowlist.mjs';

const here = dirname(fileURLToPath(import.meta.url));

test('the owner and an allowed group pass, everyone else does not', () => {
  const config = { allowedUserIds: [111, -100123] };
  assert.equal(allowedSender({ from: { id: 111 }, chat: { id: 111 } }, config), true);
  assert.equal(allowedSender({ from: { id: 222 }, chat: { id: -100123 } }, config), true, 'a listed group is allowed');
  assert.equal(allowedSender({ from: { id: 222 }, chat: { id: 222 } }, config), false);
  assert.equal(allowedSender({ from: undefined, chat: undefined }, config), false);
});

test('an empty allowlist refuses everything', () => {
  assert.equal(allowedSender({ from: { id: 1 }, chat: { id: 1 } }, { allowedUserIds: [] }), false);
});

test('every update is checked before the steer branch can reach the agent', () => {
  const source = readFileSync(join(here, '..', 'bridge.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const accept = source.slice(source.indexOf('const accept = (update'), source.indexOf('const accept = (update') + 1200);
  const check = accept.indexOf('allowedSender(msg, config)');
  const steer = accept.indexOf('steerRunningTurn');
  assert.notEqual(check, -1, 'accept must pass config to allowedSender');
  assert.ok(check < steer || steer === -1, 'the check must come before anything that reaches the agent');
});