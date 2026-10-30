// Speech is a choice, not a vendor: the same bridge must be able to run a local
// Python script, any command-line engine, or a hosted OpenAI-compatible endpoint
// without touching the code. These tests pin the dispatch, the request shape and
// the promise that a failure says what to fix without leaking the key.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const { transcribe, voiceConfigured, voiceProvider } = await import('../media.mjs');

const audio = join(mkdtempSync(join(tmpdir(), 'dsh-voice-test-')), 'note.ogg');
writeFileSync(audio, Buffer.from('OggS'));

test('the backend is taken from the config, or guessed from its old shape', () => {
  assert.equal(voiceProvider({ provider: 'openai', baseUrl: 'x', model: 'y' }), 'openai');
  assert.equal(voiceProvider({ python: 'p', script: 's' }), 'script');
  assert.equal(voiceProvider({ baseUrl: 'http://x/v1', model: 'whisper-1' }), 'openai');
  assert.equal(voiceProvider({ command: 'whisper-cli' }), 'command');
  assert.equal(voiceProvider({}), '');
  // A written-down provider wins over the keys that happen to be present.
  assert.equal(voiceProvider({ provider: 'command', python: 'p', script: 's', command: 'c' }), 'command');
});

test('a hosted setup counts as configured with the key in the environment', () => {
  assert.equal(voiceConfigured({ baseUrl: 'http://x/v1', model: 'm', apiKey: 'k' }), true);
  assert.equal(voiceConfigured({ baseUrl: 'http://x/v1', model: 'm', apiKeyEnv: 'DSH_TEST_VOICE_KEY' }), false);
  process.env.DSH_TEST_VOICE_KEY = 'k';
  try {
    assert.equal(voiceConfigured({ baseUrl: 'http://x/v1', model: 'm', apiKeyEnv: 'DSH_TEST_VOICE_KEY' }), true);
  } finally {
    delete process.env.DSH_TEST_VOICE_KEY;
  }
  assert.equal(voiceConfigured({ baseUrl: 'http://x/v1' }), false, 'a model is required');
  assert.equal(voiceConfigured({}), false);
});

test('an OpenAI-compatible endpoint receives the file, the model and the key', async () => {
  let seen = null;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      seen = { url: req.url, auth: req.headers.authorization, body };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: ' привет ' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    const out = await transcribe(audio, { provider: 'openai', baseUrl, model: 'my-whisper', apiKey: 'secret-key', language: 'ru' });
    assert.equal(out.text, 'привет');
    assert.equal(out.error, '');
  } finally {
    server.close();
  }
  assert.equal(seen.url, '/v1/audio/transcriptions');
  assert.equal(seen.auth, 'Bearer secret-key');
  assert.match(seen.body, /name="model"\r\n\r\nmy-whisper/);
  assert.match(seen.body, /name="language"\r\n\r\nru/);
  assert.match(seen.body, /filename="note\.ogg"/);
});

test('a language of "auto" is not sent, so the provider keeps its default', async () => {
  let body = '';
  const server = createServer((req, res) => {
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"text":"ok"}'); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await transcribe(audio, { provider: 'openai', baseUrl: `http://127.0.0.1:${server.address().port}`, model: 'm', apiKey: 'k', language: 'auto' });
  } finally {
    server.close();
  }
  assert.ok(!body.includes('name="language"'));
});

test('a failing endpoint is reported without the key or the audio', async () => {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"bad key"}'); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const out = await transcribe(audio, { provider: 'openai', baseUrl, model: 'm', apiKey: 'secret-key' });
    assert.match(out.error, /401/);
    assert.ok(!out.error.includes('secret-key'));
  } finally {
    server.close();
  }
});

test('a missing key names the setting, not the value', async () => {
  const out = await transcribe(audio, { provider: 'openai', baseUrl: 'http://127.0.0.1:1/v1', model: 'm' });
  assert.match(out.error, /voice\.apiKey/);
  assert.match(out.error, /voice\.apiKeyEnv/);
});

test('any local engine can answer as plain text, as JSON, or in a file', async () => {
  const plain = await transcribe(audio, {
    provider: 'command', command: process.execPath,
    args: ['-e', 'process.stdout.write("[00:00:01.000 --> 00:00:02.000]  привет\\n[BLANK_AUDIO]\\n")', '{file}'],
  });
  assert.equal(plain.text, 'привет');

  const json = await transcribe(audio, {
    provider: 'command', command: process.execPath,
    args: ['-e', 'process.stdout.write(JSON.stringify({text:"из json"}))', '{file}'], output: 'json',
  });
  assert.equal(json.text, 'из json');

  const vosk = await transcribe(audio, {
    provider: 'command', command: process.execPath,
    args: ['-e', 'process.stdout.write(JSON.stringify({result:[{text:"а"},{text:"б"}]}))', '{file}'], output: 'json',
  });
  assert.equal(vosk.text, 'а б');

  const file = await transcribe(audio, {
    provider: 'command', command: process.execPath,
    args: ['-e', 'require("fs").writeFileSync(process.argv[1],"из файла")', '{out}'],
    output: 'file',
  });
  assert.equal(file.text, 'из файла');
});

test('a busy local engine is killed at the timeout instead of pinning the turn', async () => {
  const started = Date.now();
  const out = await transcribe(audio, {
    provider: 'command', command: process.execPath,
    args: ['-e', 'setTimeout(()=>{}, 60000)', '{file}'], timeoutMs: 600,
  });
  assert.equal(out.text, '');
  assert.ok(Date.now() - started < 20000, 'the timeout cut the run short');
});
