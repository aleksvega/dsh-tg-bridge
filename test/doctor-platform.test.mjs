// `/doctor` has to answer on every platform, and it has to say which binary a
// turn would start.
//
// The report used to contain `(Get-PSDrive C)` and a row labelled "Disk C": on
// macOS and Linux the row simply disappeared, and the label was a Windows word
// on a Mac. A diagnostic that is silent on the platform you are debugging is
// worse than no diagnostic, so the disk comes from `statfs` and the label names
// the disk it actually measured.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { handleControl } from '../chat/control.mjs';
import { dshLaunch } from '../core/dsh-launch.mjs';
import { t } from '../core/i18n.mjs';

function context(overrides = {}) {
  const out = [];
  const ctx = {
    command: '/doctor',
    arg: '',
    chatId: 42,
    threadId: 7,
    key: '42:7',
    state: { sessions: {}, profiles: {}, lang: {}, titles: {}, reminders: [] },
    config: { profile: 'test', cwd: process.cwd() },
    profile: 'test',
    lang: 'en',
    activeTurns: new Map(),
    saveState: () => {},
    log: () => {},
    send: async () => {},
    reply: (text) => { out.push(text); return 1; },
    sendFile: async () => {},
    stopTurn: () => false,
    seedTopic: async () => {},
    jobs: () => ({ active: [], queued: 0, max: 3 }),
    ...overrides,
  };
  return { ctx, out };
}

const doctor = async (lang, overrides = {}) => {
  const built = context({ lang, ...overrides });
  await handleControl(built.ctx);
  return built.out.join('\n');
};

test('/doctor answers in every language', async () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const text = await doctor(lang);
    assert.ok(text.includes(t(lang, 'ctrl.doctor.title')), `${lang}: no title`);
    // A row with no value reads as a bug, and a leftover `{placeholder}` reads
    // as an unfinished translation. Both are cheap to catch here.
    for (const line of text.split('\n').slice(2)) {
      assert.ok(line.trim().length > 0, `${lang}: empty row`);
      assert.doesNotMatch(line, /\{\w+\}/, `${lang}: unfilled placeholder in "${line}"`);
    }
  }
});

test('the disk row names the disk it measured, and is there on every platform', async () => {
  const text = await doctor('en');
  const row = text.split('\n').find((line) => line.startsWith(t('en', 'ctrl.doctor.disk', { drive: '' })));
  assert.ok(row, 'the disk row is missing');
  // Either a real reading, or nothing at all when `statfs` refuses — but never a
  // literal `undefined` and never an empty unit.
  assert.doesNotMatch(row, /undefined|NaN/);
  assert.match(row, /GB|free/);
});

test('/doctor says which command a turn would run', async () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const text = await doctor(lang);
    const row = text.split('\n').find((line) => line.startsWith(t(lang, 'ctrl.doctor.turnCmd')));
    assert.ok(row, `${lang}: no turn command row`);
    // The row carries the binary `dsh-launch.mjs` picked for THIS machine, so a
    // turn that fails with ENOENT explains itself.
    assert.ok(row.includes(dshLaunch({ exists: existsSync }).exe), `${lang}: wrong binary in "${row}"`);
  }
});
