// The installer is the only file in this flow a person will double-click, so the
// tests are about the two things that matter: it lands under its expected name
// only after the hash matches, and the thing that gets opened is that file.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { downloadInstaller, formatSize } from '../core/app-install.mjs';

const BODY = Buffer.from('MZ fake installer body');

function feed(overrides = {}) {
  return {
    installer: 'https://x.test/bin/harness-0.2.1-rc.5-win-x64.exe',
    sha512: createHash('sha512').update(BODY).digest('base64'),
    size: BODY.length,
    ...overrides,
  };
}

test('a good download is written under its real name and reported as verified', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-install-'));
  const got = await downloadInstaller({
    info: feed(),
    dir,
    fetchImpl: async () => new Response(BODY),
  });
  assert.equal(got.ok, true);
  assert.equal(got.verified, true);
  assert.equal(got.path, join(dir, 'harness-0.2.1-rc.5-win-x64.exe'));
  assert.deepEqual(readFileSync(got.path), BODY);
  assert.deepEqual(readdirSync(dir), ['harness-0.2.1-rc.5-win-x64.exe'], 'no .part left behind');
});

test('a hash mismatch deletes the file instead of keeping it for a click', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-install-'));
  const got = await downloadInstaller({
    info: feed({ sha512: 'not-the-hash' }),
    dir,
    fetchImpl: async () => new Response(BODY),
  });
  assert.equal(got.ok, false);
  assert.equal(got.error, 'sha512 mismatch');
  assert.deepEqual(readdirSync(dir), [], 'nothing half-checked survives');
});

test('an HTTP error is reported, not downloaded around', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-install-'));
  const got = await downloadInstaller({ info: feed(), dir, fetchImpl: async () => new Response('no', { status: 503 }) });
  assert.equal(got.ok, false);
  assert.match(got.error, /503/);
  assert.equal(existsSync(join(dir, 'harness-0.2.1-rc.5-win-x64.exe')), false);
});

test('a feed with no installer is a refusal, not an empty download', async () => {
  const got = await downloadInstaller({ info: { version: '1' }, dir: tmpdir() });
  assert.equal(got.ok, false);
});

test('sizes read as a person says them', () => {
  assert.equal(formatSize(289_408_544), '289 MB');
  assert.equal(formatSize(1_500_000_000), '1.5 GB');
  assert.equal(formatSize(4_096), '4 KB');
  assert.equal(formatSize(0), '0 KB');
});