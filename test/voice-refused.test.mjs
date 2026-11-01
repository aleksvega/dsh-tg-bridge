// A refused key is not a misheard word.
//
// The engine answers 401 for the same reason on every attempt, so the bridge
// has to tell "ask again" apart from "asking again changes nothing". Before
// this, a batch of clips spent one request and one identical warning per clip,
// and the warning said the speech was not recognised — sending the person to
// re-record something the engine never listened to.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const { transcribe, voiceRefused } = await import('../chat/media.mjs');

const audio = join(mkdtempSync(join(tmpdir(), 'dsh-voice-refused-')), 'note.ogg');
writeFileSync(audio, Buffer.from('OggS'));

/** A server that answers every request with one status and one body. */
async function endpoint(status, body = '') {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body || JSON.stringify({ error: { message: 'nope' } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    close: () => server.close(),
  };
}

test('whether another attempt can help is decided by the status alone', () => {
  // A refused key, a model the server does not have, a request it rejects.
  for (const code of [400, 401, 403, 404]) assert.equal(voiceRefused(code), true, `${code} is a refusal`);
  // Load: the same request may well succeed in a minute.
  for (const code of [408, 429, 500, 502, 503]) assert.equal(voiceRefused(code), false, `${code} is worth retrying`);
  assert.equal(voiceRefused(undefined), false, 'no status is not a refusal');
  assert.equal(voiceRefused('401'), true, 'a status read from a string still counts');
});

test('a rejected key comes back as a refusal, with the status kept', async () => {
  const server = await endpoint(401);
  try {
    const out = await transcribe(audio, { provider: 'openai', baseUrl: server.baseUrl, model: 'whisper-1', apiKey: 'wrong' });
    assert.equal(out.text, '');
    assert.equal(out.fatal, true);
    assert.equal(out.status, 401);
    assert.match(out.error, /401/);
  } finally {
    server.close();
  }
});

test('a missing model comes back as a refusal too', async () => {
  const server = await endpoint(404);
  try {
    const out = await transcribe(audio, { provider: 'openai', baseUrl: server.baseUrl, model: 'no-such-model', apiKey: 'k' });
    assert.equal(out.fatal, true);
    assert.equal(out.status, 404);
  } finally {
    server.close();
  }
});

test('a server that is merely overloaded stays retryable', async () => {
  const server = await endpoint(503);
  try {
    const out = await transcribe(audio, { provider: 'openai', baseUrl: server.baseUrl, model: 'whisper-1', apiKey: 'k' });
    assert.equal(out.fatal, false);
    assert.equal(out.status, 503);
  } finally {
    server.close();
  }
});

test('a rate limit is load, not a refusal', async () => {
  const server = await endpoint(429);
  try {
    const out = await transcribe(audio, { provider: 'openai', baseUrl: server.baseUrl, model: 'whisper-1', apiKey: 'k' });
    assert.equal(out.fatal, false);
  } finally {
    server.close();
  }
});

test('a setup with no key never reaches the network and says what to set', async () => {
  const out = await transcribe(audio, { provider: 'openai', baseUrl: 'http://127.0.0.1:9/v1', model: 'whisper-1' });
  assert.equal(out.fatal, true, 'no key is a refusal, not a transport failure');
  assert.match(out.error, /voice\.apiKey/);
  assert.equal(out.status, undefined);
});
