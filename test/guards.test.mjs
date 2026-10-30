// Guards on the paths and processes the bridge is told to touch.
//
// Each of these was a way for one wrong string — typed in the chat, or hand-edited
// into `config.json` — to reach outside the directory the bridge owns. None of
// them is exotic; they are the four the audit kept coming back to.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const { sessionFile } = await import('../thoughts.mjs');
const { transcribe } = await import('../media.mjs');

test('a session id cannot walk out of the sessions root', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-sessions-'));
  mkdirSync(join(root, 'profile-a'), { recursive: true });
  const real = join(root, 'profile-a', 'session-1');
  mkdirSync(real, { recursive: true });
  writeFileSync(join(real, 'session.v4.jsonl.zstd'), 'ok');

  assert.equal(sessionFile(root, 'session-1'), join(real, 'session.v4.jsonl.zstd'), 'a real id still resolves');
  for (const bad of ['..', '.', '../..', '..\\..\\windows', 'a/../../b', '', 'x'.repeat(200)]) {
    assert.equal(sessionFile(root, bad), '', `${JSON.stringify(bad)} must not resolve`);
  }
});

test('the voice backend must be named by absolute path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-voice-'));
  const script = join(root, 'transcribe.py');
  writeFileSync(script, '#');

  const relative = await transcribe(join(root, 'a.ogg'), { python: 'python', script });
  assert.match(relative.error, /absolute/i);
  const relativeScript = await transcribe(join(root, 'a.ogg'), { python: process.execPath, script: 'transcribe.py' });
  assert.match(relativeScript.error, /absolute/i);

  // The message names the settings, not the paths: it is shown in the chat.
  for (const line of [relative.error, relativeScript.error]) {
    assert.ok(!line.includes(root), 'a chat line must not carry this machine\'s paths');
  }
});

test('a voice cwd that is not a directory is refused before anything runs', async () => {
  const out = await transcribe('a.ogg', { python: process.execPath, script: join(tmpdir(), 'x.py'), cwd: join(tmpdir(), 'no-such-dir-here') });
  assert.match(out.error, /cwd/i);
});
