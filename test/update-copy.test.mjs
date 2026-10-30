// `/update confirm` copied files from a path npm has not produced since v5 and
// treated every entry as a file, so the advertised update path failed on the
// first directory (`plugin/`, `skills/`). This test pins the copy half, which is
// where both faults were; the npm call around it is one spawnSync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import './sandbox-home.mjs';
import { copyRelease } from '../chat/control.mjs';

function release() {
  const dir = mkdtempSync(join(tmpdir(), 'release-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsh-tg-bridge', version: '9.9.9' }));
  writeFileSync(join(dir, 'bridge.mjs'), '// new bridge\n');
  mkdirSync(join(dir, 'plugin'), { recursive: true });
  writeFileSync(join(dir, 'plugin', 'cordis.patch.yml'), 'patch: new\n');
  mkdirSync(join(dir, 'skills', 'demo'), { recursive: true });
  writeFileSync(join(dir, 'skills', 'demo', 'SKILL.md'), '# demo\n');
  return dir;
}

test('a release is copied whole: files, nested plugin/ and skills/', () => {
  const root = mkdtempSync(join(tmpdir(), 'install-'));
  writeFileSync(join(root, 'bridge.mjs'), '// old bridge\n');
  const copied = copyRelease(release(), root, 'update-backup-test');

  assert.deepEqual(copied.sort(), ['bridge.mjs', 'package.json', 'plugin', 'skills']);
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '9.9.9');
  assert.equal(readFileSync(join(root, 'bridge.mjs'), 'utf8'), '// new bridge\n');
  assert.equal(readFileSync(join(root, 'plugin', 'cordis.patch.yml'), 'utf8'), 'patch: new\n');
  assert.equal(existsSync(join(root, 'skills', 'demo', 'SKILL.md')), true);
});

test('the replaced files are kept in the backup, next to config and state', () => {
  const root = mkdtempSync(join(tmpdir(), 'install-'));
  writeFileSync(join(root, 'bridge.mjs'), '// old bridge\n');
  writeFileSync(join(root, 'state.json'), '{"keep":true}');
  copyRelease(release(), root, 'update-backup-test');

  assert.equal(readFileSync(join(root, 'update-backup-test', 'bridge.mjs'), 'utf8'), '// old bridge\n');
  assert.equal(readFileSync(join(root, 'state.json'), 'utf8'), '{"keep":true}', 'state must survive an update');
  assert.equal(existsSync(join(root, 'update-backup-test', 'state.json')), false, 'nothing to back up, nothing copied');
});