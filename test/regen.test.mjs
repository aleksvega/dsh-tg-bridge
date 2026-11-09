import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allTurns, recentTurns } from '../work/rewind.mjs';
import { finalKeyboard } from '../turn/files.mjs';
import { regenPressState, regenRow, REGEN_CALLBACK } from '../work/regen.mjs';
import { t } from '../core/i18n.mjs';
import { writeSession } from './rewind-fixture.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-regen-'));
const PROJECT = 'c-Users-test-project';
const SESSION = 'session-33333333-4444-5555-6666-777777777777';
const SESSIONS = join(HOME, 'sessions');
mkdirSync(join(SESSIONS, PROJECT, SESSION), { recursive: true });

const THREE = [
  { user: 'один', answer: 'A' },
  { user: 'два', answer: 'B' },
  { user: 'три', answer: 'C' },
];
const fixture = writeSession(THREE);
const file = join(SESSIONS, PROJECT, SESSION, 'session.v4.jsonl.zstd');
copyFileSync(fixture.file, file);
// Backdated so the freshness guard lets the cut through: the guard has its own
// test, this one is about what `/regen` does when a cut is allowed.
const old = new Date(Date.now() - 10 * 60 * 1000);
utimesSync(file, old, old);

process.env.DSH_HOME = HOME;
const { handleControl } = await import('../chat/control.mjs');

const freshState = () => ({ sessions: { '42:7': SESSION }, profiles: {}, lang: {}, titles: {}, reminders: [] });
const sessionFileOf = () => file;

function context(overrides = {}) {
  const out = [];
  const redelivered = [];
  const ctx = {
    command: '/regen',
    arg: '',
    chatId: 42,
    threadId: 7,
    key: '42:7',
    state: freshState(),
    config: { profile: 'test', allowedUserIds: [99] },
    profile: 'test',
    lang: 'ru',
    activeTurns: new Map(),
    saveState: () => {},
    log: () => {},
    send: async () => {},
    reply: (text) => { out.push(text); return 1; },
    sendFile: async () => {},
    stopTurn: () => false,
    seedTopic: async () => {},
    openTopic: async () => 0,
    redeliver: (key, message) => { redelivered.push({ key, message }); },
    jobs: () => ({ active: [], queued: 0, max: 3 }),
    ...overrides,
  };
  return { ctx, out, redelivered };
}

const run = async (command, arg = '', overrides = {}) => {
  const built = context({ command, arg, ...overrides });
  await handleControl(built.ctx);
  return { ...built, text: built.out.join('\n') };
};

test('/regen cuts the last turn and feeds its question back as a message', async () => {
  const { out, redelivered } = await run('/regen');
  assert.equal(out[0], t('ru', 'ctrl.regen.working'), 'the ack line did not come first');
  assert.equal(redelivered.length, 1, 'nothing was re-asked');
  assert.equal(redelivered[0].key, '42:7');
  assert.equal(redelivered[0].message.text, 'три', 'the re-ask was not the last question');
  assert.equal(redelivered[0].message.from.id, 99, 'the re-ask was not from the owner');
  assert.equal(allTurns(file).length, 2, 'the exchange was left in the session');
  // The turn's own card answers for the new run, so no second line is sent.
  assert.equal(out.length, 1);
});

test('/regen refuses when the topic has no session, in one line', async () => {
  const { out } = await run('/regen', '', { state: { sessions: {}, profiles: {}, lang: {}, titles: {}, reminders: [] } });
  assert.equal(out.length, 1, 'a refusal sent more than its sentence');
  assert.match(out[0], /нет сессии|no session/i);
});

test('/regen leaves the session alone when the last turn has no question text', async () => {
  const noText = writeSession([{ user: 'один', answer: 'A' }, { user: '', answer: 'C' }]);
  const silent = join(SESSIONS, PROJECT, SESSION, 'session.v4.jsonl.zstd');
  const source = silent;
  copyFileSync(noText.file, source);
  utimesSync(source, old, old);
  const { out, redelivered } = await run('/regen');
  assert.equal(redelivered.length, 0, 'an attachment-only turn was re-asked as empty text');
  assert.match(out[out.length - 1], /нет текста|no question/i);
  assert.equal(allTurns(source).length, 2, 'a refused regen still cut the session');
  // Put the ordinary fixture back for the tests that follow.
  copyFileSync(fixture.file, silent);
  utimesSync(silent, old, old);
});

test('/regen refuses while a turn is running', async () => {
  const { out, redelivered } = await run('/regen', '', { activeTurns: new Map([['42:7', { startedAt: Date.now() }]]) });
  assert.equal(redelivered.length, 0);
  assert.match(out[0], /идёт ход|turn is running/);
});

test('a press is checked against the live session, not the card', () => {
  const tail = SESSION.slice(-8);
  const ok = regenPressState(`rg:3:${tail}`, { sessionId: SESSION, busy: false, file: sessionFileOf() });
  assert.equal(ok.verdict, 'ok');
  assert.equal(ok.turn, 3);
  assert.equal(ok.user, 'три');

  assert.equal(regenPressState(`rg:2:${tail}`, { sessionId: SESSION, busy: false, file: sessionFileOf() }).verdict, 'stale', 'an older card of the same session cut the wrong turn');
  assert.equal(regenPressState(`rg:3:${'0'.repeat(8)}`, { sessionId: SESSION, busy: false, file: sessionFileOf() }).verdict, 'stale', 'a moved topic still pressed');
  assert.equal(regenPressState(`rg:3:${tail}`, { sessionId: SESSION, busy: true, file: sessionFileOf() }).verdict, 'busy');
  assert.equal(regenPressState('rg:3:zzzzzzzz', { sessionId: SESSION, busy: false, file: sessionFileOf() }).verdict, 'stale');
  assert.ok(REGEN_CALLBACK.test(`rg:3:${tail}`));
});

test('the final card carries the ↻ row above any file rows', () => {
  const row = regenRow(SESSION, sessionFileOf(), 'ru', (lang, k) => t(lang, k));
  assert.equal(row.length, 1);
  assert.equal(row[0].text, `↻ ${t('ru', 'btn.regen')}`);
  assert.equal(row[0].callback_data, `rg:3:${SESSION.slice(-8)}`);

  assert.deepEqual(regenRow('', '', 'ru', (lang, k) => t(lang, k)), [], 'a sessionless topic drew a button');

  const saved = [];
  const turnFilesState = freshState();
  const rows = finalKeyboard({
    calls: [{ tool: 'write', input: { file_path: 'C:\\w\\out.md' } }],
    state: turnFilesState,
    key: '42:7',
    save: () => { saved.push(1); },
    lang: 'ru',
    t: (lang, k) => t(lang, k),
    sessionId: SESSION,
    sessionsRoot: SESSIONS,
  });
  assert.equal(rows.length, 2, 'the regen row and the file row did not both land');
  assert.match(rows[0][0].callback_data, /^rg:3:/, 'the regen row is not first');
  assert.match(rows[1][0].callback_data, /^tf:/);
  assert.equal(turnFilesState.turnFiles['42:7'].length, 1);
  assert.equal(saved.length, 1, 'the file rows were not stored for the press');
});
