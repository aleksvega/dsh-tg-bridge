// What a search for plugins says in the chat, and what its buttons send. The
// rule from the rest of the bridge holds here: a button is a shortcut for a
// command, so a tap runs `/plugin add <name>` and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rowLine, searchPlugins } from '../plugin-search.mjs';

const answer = (body, ok = true, status = 200) => async () => ({
  ok,
  status,
  json: async () => body,
});

test('a search asks the registry for the dsh-plugin keyword', async () => {
  const seen = [];
  await searchPlugins('telegram', {
    fetchImpl: async (url) => {
      seen.push(url);
      return (answer({ objects: [] }))();
    },
  });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /registry\.npmjs\.org/);
  assert.match(decodeURIComponent(seen[0]), /keywords:dsh-plugin telegram/);
});

test('results keep name, version and a one-line description', async () => {
  const result = await searchPlugins('telegram', {
    fetchImpl: answer({
      objects: [
        { package: { name: 'dsh-tg-bridge', version: '1.19.0', description: 'Telegram bridge  for DSH', date: '2026-10-26T20:00:00.000Z' } },
        { package: { name: 'dsh-theme-dark', version: '1.0.0', description: 'other' } },
      ],
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 2, 'both objects the registry returned are shown');
  assert.deepEqual(result.rows[0], {
    name: 'dsh-tg-bridge',
    version: '1.19.0',
    description: 'Telegram bridge for DSH',
    date: '2026-10-26',
  });
});

test('a failed search is reported as a failure, not as an empty list', async () => {
  // "Nothing found" and "the registry did not answer" send a person in opposite
  // directions, so they must not look the same in the chat.
  const down = await searchPlugins('x', { fetchImpl: answer({}, false, 503) });
  assert.equal(down.ok, false);
  assert.equal(down.rows.length, 0);
  assert.match(down.error, /503/);

  const thrown = await searchPlugins('x', { fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
  assert.equal(thrown.ok, false);
  assert.match(thrown.error, /ENOTFOUND/);

  const junk = await searchPlugins('x', { fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  assert.equal(junk.ok, true);
  assert.deepEqual(junk.rows, [], 'a body with no objects is an honest empty result');
});

test('a row reads as a block, and marks what is already installed', () => {
  const row = { name: 'dsh-tg-bridge', version: '1.19.0', description: 'Telegram bridge for DSH', date: '' };
  const plain = rowLine(row);
  assert.match(plain, /^dsh-tg-bridge 1\.19\.0/);
  assert.match(plain, /Telegram bridge/);
  assert.match(rowLine(row, true), /^• dsh-tg-bridge/);
  // Long descriptions are cut once, in the module, so every caller shows the same.
  const long = rowLine({ name: 'p', version: '1', description: 'x'.repeat(400) });
  assert.ok(long.length < 140);
});
