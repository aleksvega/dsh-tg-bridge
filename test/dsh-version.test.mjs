// Version comparison is the one part of `/dsh` that can be wrong without
// anybody noticing: the card still draws, it just lies about compatibility. The
// cases below are the ones the real versions produce -- prerelease ordering is
// where a naive string compare fails first (0.2.1-rc.10 sorts before 0.2.1-rc.2).
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appDshVersion,
  asarJson,
  compareVersions,
  dshStatus,
  installedDsh,
  parseVersion,
  satisfies,
  testedRange,
} from '../core/dsh-version.mjs';
import { fakeApp, fakeAsar } from './helpers/fake-asar.mjs';

const RANGE = '>=0.2.1-rc.2 <0.3.0-0 || >=0.2.2-rc.1 <0.3.0-0';

test('a version parses into parts, or refuses to', () => {
  assert.deepEqual(parseVersion('0.2.1-rc.3'), { major: 0, minor: 2, patch: 1, pre: ['rc', '3'] });
  assert.deepEqual(parseVersion(' v1.10.0'), { major: 1, minor: 10, patch: 0, pre: [] });
  assert.deepEqual(parseVersion('0.2.1-rc.3\n'), { major: 0, minor: 2, patch: 1, pre: ['rc', '3'] }, 'the CLI ends its answer with a newline');
  assert.equal(parseVersion('0.2.1 something'), null, 'a sentence is not a version');
  assert.equal(parseVersion(''), null);
});

test('prereleases order numerically, not as text', () => {
  assert.equal(compareVersions('0.2.1-rc.2', '0.2.1-rc.5'), -1);
  assert.equal(compareVersions('0.2.1-rc.10', '0.2.1-rc.9'), 1);
  assert.equal(compareVersions('0.2.1', '0.2.1-rc.5'), 1, 'a release outranks its prereleases');
  assert.equal(compareVersions('0.2.1-1', '0.2.1-alpha'), -1, 'numeric sorts below alphanumeric');
  assert.equal(compareVersions('0.2.2-alpha.2', '0.3.0-0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
});

test('the range this bridge declares accepts the versions it was tested on', () => {
  assert.equal(satisfies('0.2.1-rc.2', RANGE), true, 'the lower bound itself counts');
  assert.equal(satisfies('0.2.1-rc.3', RANGE), true);
  assert.equal(satisfies('0.2.1-rc.5', RANGE), true);
  assert.equal(satisfies('0.2.2-alpha.2', RANGE), true);
  assert.equal(satisfies('0.2.0', RANGE), false);
  assert.equal(satisfies('0.2.1-rc.1', RANGE), false);
  assert.equal(satisfies('0.3.0', RANGE), false, '0.3.0 is a new major line');
  assert.equal(satisfies('0.3.0-0', RANGE), false, 'the upper bound is exclusive');
  assert.equal(satisfies('garbage', RANGE), null, 'unreadable is not incompatible');
  assert.equal(satisfies('0.2.1', ''), null);
});

test('the declared range is read from this package, not copied into code', () => {
  assert.match(testedRange(), />=0\.2\.1-rc\.\d+ <0\.3\.0-0/);
});

test('the card calls an unknown latest "unknown", never "up to date"', () => {
  const offline = dshStatus({ installed: '0.2.1-rc.3', latest: '' });
  assert.equal(offline.outdated, false);
  assert.equal(offline.tested, true);
  const behind = dshStatus({ installed: '0.2.1-rc.3', latest: '0.2.1-rc.5' });
  assert.equal(behind.outdated, true);
  const ahead = dshStatus({ installed: '0.2.2-alpha.2', latest: '0.2.1-rc.5' });
  assert.equal(ahead.outdated, false, 'a version newer than npm latest is not outdated');
  assert.equal(dshStatus({ installed: '' }).tested, null, 'no version, no claim');
});

test('installedDsh reads once and can be told to re-read', () => {
  let calls = 0;
  const run = () => {
    calls++;
    return '0.2.1-rc.3\n';
  };
  assert.equal(installedDsh({ run, fresh: true }), '0.2.1-rc.3');
  assert.equal(installedDsh({ run }), '0.2.1-rc.3');
  assert.equal(calls, 1, 'the second call must not spawn anything');
  assert.equal(installedDsh({ run, fresh: true }), '0.2.1-rc.3');
  assert.equal(calls, 2);
  assert.equal(installedDsh({ run: () => 'not a version', fresh: true }), '');
});
test('the DSH the app carries is readable from its archive, not guessed', () => {
  const exe = fakeApp('0.2.1-rc.3');
  assert.equal(appDshVersion(exe), '0.2.1-rc.3', 'the version npm cannot see');
  assert.equal(appDshVersion(''), '');
  assert.equal(appDshVersion('C:/nowhere/DeepSeek Harness.exe'), '', 'no archive, no claim');
});

test('an archive with the entry missing or the bytes cut reads as unknown, not as a crash', () => {
  const exe = fakeApp('0.2.1-rc.5');
  const archive = exe.replace('DeepSeek Harness.exe', 'resources/app.asar');
  assert.equal(asarJson(archive, 'dsh/nothing/here/package.json'), null);
  // A text file is not an archive: the header read must fail closed.
  const broken = fakeAsar(archive.replace('app.asar', 'broken.asar'), { 'a.json': '{}' });
  assert.deepEqual(asarJson(broken, 'a.json'), {});
  assert.equal(asarJson(archive, 'main.js'), null, 'not JSON is not a package');
});
