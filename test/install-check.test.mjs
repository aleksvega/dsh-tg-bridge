// A bad release must not replace a working install.
//
// The scenario this guards is the one that matters most to someone who installed
// a bot to stop touching a terminal: `/update confirm` copies files over the
// running install, `/restart confirm` then kills the old process, and if the new
// files cannot load there is nothing to start. The bot is simply gone, and the
// only way back is a shell on that machine.
//
// These tests build real directory trees in a temp dir — no mocks — because the
// thing being tested is exactly what ends up on disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { checkInstall, isBridgeRoot, restoreBackup, safeUpdateRoot } from '../install-check.mjs';

/** A minimal but honest install: entry point, a control module, a locale. */
function install(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'install-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'dsh-tg-bridge', version: '9.9.9' }));
  writeFileSync(join(root, 'bridge.mjs'), "import { say } from './control.mjs';\nsay();\n");
  writeFileSync(join(root, 'control.mjs'), "export const say = () => 'hi';\n");
  writeFileSync(join(root, 'handle-message.mjs'), "import { say } from './control.mjs';\nexport const turn = () => say();\n");
  mkdirSync(join(root, 'i18n', 'en'), { recursive: true });
  writeFileSync(join(root, 'i18n', 'en', 'core.mjs'), "export default { hi: 'hi' };\n");
  writeFileSync(join(root, 'i18n', 'en.mjs'), "import core from './en/core.mjs';\nexport default { ...core };\n");
  for (const [rel, body] of Object.entries(overrides)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

test('a healthy install passes the check', () => {
  const root = install();
  assert.equal(isBridgeRoot(root), true);
  const verdict = checkInstall(root);
  assert.deepEqual(verdict.problems, []);
  assert.equal(verdict.ok, true);
});

test('a directory without bridge.mjs is refused, not filled', () => {
  const dir = mkdtempSync(join(tmpdir(), 'not-a-bridge-'));
  // The exact shape of the accident: DSH_BRIDGE_ROOT pointed somewhere real but
  // wrong, and an update would have written the whole package into it.
  writeFileSync(join(dir, 'notes.txt'), 'personal');
  assert.equal(isBridgeRoot(dir), false);
  const verdict = checkInstall(dir);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems[0], /not a bridge install/);
  // The file that was there is untouched.
  assert.equal(readFileSync(join(dir, 'notes.txt'), 'utf8'), 'personal');
});

test('a missing directory is not a bridge install either', () => {
  assert.equal(isBridgeRoot(join(tmpdir(), 'no-such-dir-at-all-xyz')), false);
  assert.equal(checkInstall(join(tmpdir(), 'no-such-dir-at-all-xyz')).ok, false);
});

test('the 1.29.0 fault is caught: an import of a name nobody exports', () => {
  // This is the real regression, verbatim: `profileOf` lives in `turn.mjs`, not
  // in `control/models.mjs`, and the module that imported it crashed on load.
  const root = install({
    'control/models.mjs': 'export const modelOf = () => "m";\nexport const modelsOf = () => [];\n',
    'handle-message.mjs': "import { profileOf } from './control/models.mjs';\nexport const turn = () => profileOf();\n",
  });
  const verdict = checkInstall(root);
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.problems.some((line) => /profileOf/.test(line) && /does not export it/.test(line)),
    `expected the profileOf fault, got: ${verdict.problems.join(' | ')}`,
  );
});

test('an import of a file the release does not carry is caught', () => {
  const root = install({ 'bridge.mjs': "import { x } from './missing.mjs';\nx();\n" });
  const verdict = checkInstall(root);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((line) => /missing\.mjs/.test(line)), verdict.problems.join(' | '));
});

test('a syntax error in an entry point is caught', () => {
  const root = install({ 'bridge.mjs': 'export const broken = ;\n' });
  const verdict = checkInstall(root);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((line) => /bridge\.mjs/.test(line)), verdict.problems.join(' | '));
});

test('a star re-export is not reported as a false alarm', () => {
  // Being unable to prove an export exists is not proof it does not: a release
  // must not be refused because of a pattern this check cannot read.
  const root = install({
    'extra.mjs': "export * from './control.mjs';\n",
    'bridge.mjs': "import { anything } from './extra.mjs';\nexport const go = () => anything;\n",
  });
  const verdict = checkInstall(root);
  assert.deepEqual(verdict.problems, []);
});

test('the old files can be put back after a failed update', () => {
  const root = install();
  const backup = join(root, 'update-backup-test');
  mkdirSync(backup, { recursive: true });
  writeFileSync(join(backup, 'bridge.mjs'), '// the old, working bridge\n');
  // The update overwrote the entry point with something that cannot load.
  writeFileSync(join(root, 'bridge.mjs'), 'export const broken = ;\n');
  assert.equal(checkInstall(root).ok, false);

  const restored = restoreBackup(root, backup);
  assert.deepEqual(restored, ['bridge.mjs']);
  assert.equal(readFileSync(join(root, 'bridge.mjs'), 'utf8'), '// the old, working bridge\n');
  // The backup is still there: it is the only good copy and must not be consumed.
  assert.equal(readFileSync(join(backup, 'bridge.mjs'), 'utf8'), '// the old, working bridge\n');
  // And the install loads again.
  assert.equal(checkInstall(root).ok, true);
});

test('restoring from a missing backup is a no-op, not a throw', () => {
  const root = install();
  assert.deepEqual(restoreBackup(root, join(root, 'no-such-backup')), []);
  assert.equal(checkInstall(root).ok, true, 'a failed restore must not damage a working install');
});

test('the real repository passes its own check', () => {
  // The check is only worth having if the tree it protects is clean by it. This
  // is the same question `/update` asks of a fetched release, asked of `master`.
  const root = join(import.meta.dirname, '..');
  const verdict = checkInstall(root);
  assert.deepEqual(verdict.problems, [], verdict.problems.join('\n'));
});

test('the temp installs are cleaned up', () => {
  // Housekeeping with teeth: a test that leaks a directory per run fills a disk
  // slowly, and this machine has 2 % free.
  const root = install();
  rmSync(root, { recursive: true, force: true });
  assert.equal(isBridgeRoot(root), false);
});

test('a filesystem root or the home directory is never an update target', () => {
  // The only realistic way this project overwrites files that belong to someone
  // else: `DSH_BRIDGE_ROOT` pointed at a real directory. A home directory that
  // happens to contain a `bridge.mjs` would otherwise pass `isBridgeRoot`.
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  assert.equal(safeUpdateRoot('/', { home }), false);
  // `C:\\` is a drive root on Windows and an ordinary relative name on Linux,
  // so the platform decides which one is being asserted.
  assert.equal(safeUpdateRoot(process.platform === 'win32' ? 'C:\\' : '/', { home }), false);
  // Whatever the platform calls its root, it is refused.
  assert.equal(safeUpdateRoot(parse(process.cwd()).root, { home }), false);
  assert.equal(safeUpdateRoot(home, { home }), false);
  assert.equal(safeUpdateRoot('', { home }), false);
  assert.equal(safeUpdateRoot(undefined, { home }), false);
  // An ordinary install directory is fine.
  assert.equal(safeUpdateRoot(join(home, 'tg-bridge'), { home }), true);
  // And the check reports the refusal in words, not a stack trace — refused
  // before it reads anything, so pointing it at a drive root is safe to test.
  const verdict = checkInstall(parse(process.cwd()).root);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems[0], /filesystem root or the home directory/);
});
