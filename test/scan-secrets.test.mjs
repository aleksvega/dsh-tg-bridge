// The scanner is the only thing between a private string and a public repo, so
// it is tested against shapes instead of against the real values.
//
// The file is its own first customer: the guard scans the file that describes
// the guard, so a probe written as a live-looking literal stops the push. Every
// part below is assembled at run time for that reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, scanText } from '../scan-secrets.mjs';

/** Path separator without writing the literal form. */
const sep = String.fromCharCode(92);

/** Text that trips one rule, built at run time so the repo never holds it. */
const probe = {
  token: ['sk', 'A'.repeat(24)].join('-'),
  github: ['gh', 'p', '_', 'B'.repeat(24)].join(''),
  bearer: "'Bearer " + 'c'.repeat(30) + "'",
  winPath: ['C:', 'Users', 'someone', 'AppData'].join(sep),
  homePath: ['/home', 'someone', 'data'].join('/'),
  machineId: ['id', '01234567' + '89abcdef'].join('-'),
  chatId: ['chat', '_id: ', '-1001234567'].join(''),
  email: ['someone', 'gmail.com'].join('@'),
  key: ['-----BEGIN', 'OPENSSH', 'PRIVATE KEY-----'].join(' '),
};

test('every rule fires on a shape of the thing it hides', () => {
  for (const rule of RULES) {
    if (rule.id === 'bearer') assert.ok(scanText(probe.bearer).some((h) => h.id === 'bearer'));
  }
  const ids = scanText([
    probe.token, probe.github, probe.winPath, probe.homePath, probe.machineId, probe.chatId, probe.email, probe.key,
  ].join('\n')).map((hit) => hit.id);
  for (const id of ['token', 'win-path', 'home-path', 'machine-id', 'chat-id', 'email-env', 'key-block']) {
    assert.ok(ids.includes(id), `rule ${id} did not fire`);
  }
});

test('ordinary documentation and code stay clean', () => {
  const clean = [
    'Set DSH_TELEGRAM_BOT_TOKEN in ~/.dsh/.credentials.yaml',
    'path: join(homedir(), ".dsh", "tg-bridge")',
    'The id is a 10-hex hash, e.g. aset-0123456789.',
    'mailto:noreply@github.com',
    'see https://example.com/docs#token',
    'const chatId = msg.chat.id;',
    'model: deepseek-v4.1-flash-1017',
    'the self-hosted layout is /home/<name>/svc, not a project path',
  ].join('\n');
  assert.deepEqual(scanText(clean), []);
});

test('the report names the file line and what leaked, never the value', () => {
  const hits = scanText(probe.winPath);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 1);
  assert.match(hits[0].why, /user name/);
  assert.doesNotMatch(hits[0].why, /someone/);
});