// The app's update feed is two small files: `app-update.yml` (a URL and a
// channel) and the channel's manifest (a version, an installer, a hash). Both are
// read by regexes, so the tests pin the exact shapes the real files use — the
// folded `url: >-` block is where a naive reader returns the literal ">-".
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { appUpdateInfo, feedUrl, parseFeed, parseUpdateConfig } from '../core/app-feed.mjs';

const MANIFEST = `version: 0.2.1-rc.5
files:
  - url: >-
      https://download.example.test/app/bin/win-x64/harness-0.2.1-rc.5-win-x64.exe
    sha512: >-
      gu2dH+aTr678c0P8DGAH/h4B1GaWfQIjpsPrLjl/ukLrQIh6DLVq/MhX4FZvJ8o1GCMocOhix6XbLa6KmtjXXg==
    size: 289408544
path: >-
  https://download.example.test/app/bin/win-x64/harness-0.2.1-rc.5-win-x64.exe
releaseDate: '2026-10-29T14:04:01.198Z'
`;

test('the app config yields a base URL and a channel', () => {
  const cfg = parseUpdateConfig('provider: generic\nurl: https://download.example.test/feeds/win-x64/\nchannel: nightly\n');
  assert.deepEqual(cfg, { url: 'https://download.example.test/feeds/win-x64/', channel: 'nightly' });
  assert.deepEqual(parseUpdateConfig('provider: generic\n'), { url: '', channel: '' }, 'no url, nothing to claim');
});

test('a channel becomes a file name, and no channel means latest.yml', () => {
  assert.equal(feedUrl({ url: 'https://x.test/f/', channel: 'nightly' }), 'https://x.test/f/nightly.yml');
  assert.equal(feedUrl({ url: 'https://x.test/f', channel: 'nightly' }), 'https://x.test/f/nightly.yml');
  assert.equal(feedUrl({ url: 'https://x.test/f/', channel: '' }), 'https://x.test/f/latest.yml');
  assert.equal(feedUrl({}), '');
});

test('a folded url block is read as the installer, not as ">-"', () => {
  const feed = parseFeed(MANIFEST);
  assert.equal(feed.version, '0.2.1-rc.5');
  assert.equal(feed.installer, 'https://download.example.test/app/bin/win-x64/harness-0.2.1-rc.5-win-x64.exe');
  assert.match(feed.sha512, /^gu2dH\+/);
});

test('the version and the installer come from the feed the installer names', async () => {
  const root = join(mkdtempSync(join(tmpdir(), 'dsh-feed-')), 'Harness');
  mkdirSync(join(root, 'resources'), { recursive: true });
  writeFileSync(join(root, 'Harness.exe'), '', 'utf8');
  writeFileSync(join(root, 'resources', 'app-update.yml'), 'provider: generic\nurl: https://x.test/feeds/win-x64/\nchannel: nightly\n', 'utf8');
  const asked = [];
  const info = await appUpdateInfo({
    exe: join(root, 'Harness.exe'),
    fetchText: async (url) => {
      asked.push(url);
      return MANIFEST;
    },
  });
  assert.deepEqual(asked, ['https://x.test/feeds/win-x64/nightly.yml']);
  assert.equal(info.version, '0.2.1-rc.5');
  assert.equal(info.channel, 'nightly');
});

test('a feed that cannot be reached answers nothing, not a guess', async () => {
  const root = join(mkdtempSync(join(tmpdir(), 'dsh-feed-')), 'Harness');
  mkdirSync(join(root, 'resources'), { recursive: true });
  writeFileSync(join(root, 'Harness.exe'), '', 'utf8');
  writeFileSync(join(root, 'resources', 'app-update.yml'), 'url: https://x.test/f/\nchannel: nightly\n', 'utf8');
  const exe = join(root, 'Harness.exe');
  assert.equal(await appUpdateInfo({ exe, fetchText: async () => { throw new Error('offline'); } }), null);
  assert.equal(await appUpdateInfo({ exe: '', fetchText: async () => MANIFEST }), null, 'no app, no feed');
  assert.equal(await appUpdateInfo({ exe, fetchText: async () => 'releaseDate: 2026-10-29\n' }), null, 'no version is not a version');
});