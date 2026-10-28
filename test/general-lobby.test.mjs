// The General topic ("Все") is the lobby: a message written there is moved into
// the most recently active topic so one project stays in one place. For a plain
// prompt that is the whole point. For a command that CHANGES state it was a trap:
// `/new` typed in General wiped the session of another topic, `/rewind` rolled one
// back, and the answer appeared in that topic rather than where it was typed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// The guard moved with `handleMessage` into `handle-message.mjs`; the list it
// consults lives in `commands.mjs`. Each half is asserted where it now lives.
const source = readFileSync(join(here, '..', 'handle-message.mjs'), 'utf8');
const commands = readFileSync(join(here, '..', 'commands.mjs'), 'utf8');

test('a state-changing command typed in General is refused, not redirected', () => {
  assert.match(source, /const recoveredTopic = typedInGeneral && threadId > 0 \? threadId : 0;/);
  const guard = source.slice(source.indexOf('if (recoveredTopic > 0 && effective'));
  assert.match(guard.slice(0, 400), /GENERAL_SAFE\.has/, 'the guard must consult one list');
  assert.match(guard.slice(0, 400), /msg\.generalGuard/, 'it must say why and where');
});

test('the lobby still lets a person read and stop from General', () => {
  const at = commands.indexOf('const GENERAL_SAFE');
  assert.ok(at > 0, 'GENERAL_SAFE must exist in commands.mjs');
  const list = commands.slice(at, commands.indexOf(']);', at));
  for (const name of ['status', 'sessions', 'stop', 'help']) {
    assert.ok(list.includes(`'${name}'`), `${name} must work from General`);
  }
  for (const name of ['new', 'rewind', 'cd', 'fork']) {
    assert.ok(!list.includes(`'${name}'`), `${name} changes a topic and must not run from General`);
  }
});
