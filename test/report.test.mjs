// The report is the one place where a log tail leaves the machine, so the test
// that matters is not "the fields are there" but "nothing in the output trips the
// repo's own secret scanner". The fixture is a log line set written to look like
// a real one: a provider key in a URL, a bot token, a home path, a chat id.
//
// The fake credentials are assembled from pieces on purpose — this file is
// committed, and `scan-secrets.mjs` runs over the staged diff. A literal that the
// scanner would flag in the repo is a literal that must not be written here.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MAX_CHARS, TAIL_LINES, buildReport, redact, tailOf, writeReport } from '../work/report.mjs';
import { scanText } from '../scan-secrets.mjs';

const HOME = ['C:', 'Users', 'tester'].join('\\');
const KEY = ['sk', 'abcdefghijklmnopqrstuvwxyz0123'].join('-');
const BOT = ['123456789', 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'].join(':');
const BEARER = ['eyJhbGciOiJIUzI1NiJ9', 'abcdefghijklmnop'].join('.');
// A made-up account, not the owner's: this file is public, and a real chat id in
// a fixture is the exact leak `/report` exists to prevent.
const CHAT = '777000123';
const HEX = ['0A1B2C3D', '4E5F6071'].join('');
const MAIL = ['someone', 'gmail.com'].join('@');

/** Lines of the shape `bridge.log` actually carries. */
const LOG = [
  '2026-10-29 09:12:01 bridge started',
  `2026-10-29 09:12:03 in ${CHAT} topic=4242 "check the build"`,
  `2026-10-29 09:12:04 curl https://api.example.com/v1?key=${KEY}`,
  `2026-10-29 09:12:05 Authorization: Bearer ${BEARER}`,
  `2026-10-29 09:12:06 bot token ${BOT}`,
  `2026-10-29 09:12:07 cwd ${HOME}\\.dsh\\tg-bridge`,
  `2026-10-29 09:12:08 chat_id: ${CHAT} thread=4242`,
  `2026-10-29 09:12:09 machine ${HEX}`,
  `2026-10-29 09:12:10 mail ${MAIL}`,
  '2026-10-29 09:12:11 turn failed 31s tools=4 model=deepseek/chat :: Error: sandbox escalation requires approval',
];

test('a real-shaped log tail comes out clean under the repo scanner', () => {
  const text = buildReport({
    version: '1.25.0',
    profile: 'headless',
    preset: 'workspace-write',
    model: 'deepseek/chat',
    chain: 'deepseek/chat → free/chat',
    cwd: `${HOME}\\Projects\\thing`,
    failure: LOG[9],
    log: LOG,
    home: HOME,
    ids: [CHAT, '4242'],
    note: 'bot went silent after /cd',
  });
  assert.deepEqual(scanText(text), [], 'the bundle must not contain a secret by the scanner\'s rules');
  // The facts a maintainer needs survive: redaction removes identity, not cause.
  assert.match(text, /bridge:\s+1\.25\.0/);
  assert.match(text, /preset:\s+workspace-write/);
  assert.match(text, /sandbox escalation requires approval/);
  assert.match(text, /note:\s+bot went silent after \/cd/);
  assert.doesNotMatch(text, new RegExp(CHAT));
});

test('each family is replaced, not merely dropped from the log', () => {
  assert.equal(redact(KEY, HOME), '<token>');
  assert.equal(redact(`cwd ${HOME}\\x`, HOME), 'cwd <home>\\x');
  assert.equal(redact(`cwd ${HOME.replace(/\\/g, '/')}/x`, HOME), 'cwd <home>/x');
  assert.equal(redact(`chat_id: ${CHAT}`, HOME), 'chat_id: <id>');
  assert.equal(redact(`mail ${MAIL}`, HOME), 'mail <email>');
  assert.equal(redact(`machine ${HEX}`, HOME), 'machine <hex>');
  assert.equal(redact(`Bearer ${BEARER}`, HOME), 'Bearer <token>');
  assert.equal(redact(BOT, HOME), '<bot-token>');
});

test('a home path under another user is caught without knowing that home', () => {
  // `home` is the reporter's own directory; a log line can carry a second
  // machine's path (a peer, a CI box), and the pattern has to catch it alone.
  const other = ['C:', 'Users', 'someone-else', 'project'].join('\\');
  assert.equal(redact(other, HOME), '<home>\\project');
  const posix = ['', 'home', 'someone', 'project', 'x'].join('/');
  assert.equal(redact(posix, HOME), '<home>/project/x');
  assert.deepEqual(scanText(redact(['see ', 'Users', 'bob', 'x.mjs'].join('/'), HOME)), []);
});

test('nothing in the bundle is unbounded', () => {
  const huge = Array.from({ length: 5000 }, (_, i) => `line ${i} ${'x'.repeat(80)}`);
  const text = buildReport({ log: huge, home: HOME });
  assert.ok(text.length <= MAX_CHARS + 20, `bundle was ${text.length} chars`);
  assert.match(text, /truncated/);
});

test('a missing fact says unknown instead of disappearing', () => {
  const text = buildReport({ log: [], home: HOME });
  assert.match(text, /profile:\s+unknown/);
  assert.match(text, /model:\s+unknown/);
  assert.match(text, /chain:\s+none/);
  assert.match(text, /tools:\s+none in this turn/);
  assert.doesNotMatch(text, /## log tail/);
});

test('the log tail keeps the newest lines and tolerates a missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-report-'));
  try {
    const file = join(dir, 'bridge.log');
    const lines = Array.from({ length: TAIL_LINES + 40 }, (_, i) => `line ${i}`);
    writeFileSync(file, lines.join('\n'), 'utf8');
    const tail = tailOf(file);
    assert.equal(tail.length, TAIL_LINES);
    assert.equal(tail.at(-1), `line ${TAIL_LINES + 39}`);
    assert.deepEqual(tailOf(join(dir, 'nope.log')), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeReport puts one timestamped file in the bridge dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-report-'));
  try {
    const at = new Date('2026-10-29T09:12:31.500Z');
    const path = writeReport('# report', dir, at);
    assert.equal(path, join(dir, 'report-2026-10-29T09-12-31.md'));
    assert.match(readFileSync(path, 'utf8'), /^# report\n$/);
    // Two reports from one topic must not overwrite each other.
    const second = writeReport('# second', dir, new Date('2026-10-29T09:13:00.000Z'));
    assert.notEqual(second, path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeReport reports failure instead of throwing', () => {
  // A path that cannot be a directory on any OS: the caller has to answer in the
  // chat, so this must return '' rather than take the turn down.
  const root = mkdtempSync(join(tmpdir(), 'dsh-report-'));
  try {
    const file = join(root, 'not-a-dir');
    writeFileSync(file, '', 'utf8');
    assert.equal(writeReport('# x\n', join(file, 'reports')), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
