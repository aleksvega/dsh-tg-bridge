// /branch has two forms, and neither is `/fork`.
//
// `/branch <id>` brings another session INTO this topic; `/branch new` carries
// this topic's session into a topic of its own; `/fork` stays the copy this topic
// moves onto. The file work lives in rewind.mjs and is tested there — here the
// subject is where the copy ends up, what the person is told, and what happens
// when Telegram refuses to open the topic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allTurns, branchTarget } from '../work/rewind.mjs';
import { writeSession } from './rewind-fixture.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-branch-'));
const PROJECT = 'c-Users-test-project';
const SESSION = 'session-test';
const OTHER = 'session-11111111-2222-3333-4444-555555555555';
const SESSIONS = join(HOME, 'sessions');
mkdirSync(join(SESSIONS, PROJECT, SESSION), { recursive: true });
mkdirSync(join(SESSIONS, PROJECT, OTHER), { recursive: true });

const THREE = [
  { user: 'one', answer: 'A' },
  { user: 'two', answer: 'B' },
  { user: 'three', answer: 'C' },
];

// Two sessions where the app would put them, backdated so the freshness guard
// lets them through: the guard itself has its own test.
const fixture = writeSession(THREE);
const file = join(SESSIONS, PROJECT, SESSION, 'session.v4.jsonl.zstd');
const otherFile = join(SESSIONS, PROJECT, OTHER, 'session.v4.jsonl.zstd');
copyFileSync(fixture.file, file);
copyFileSync(fixture.file, otherFile);
const old = new Date(Date.now() - 10 * 60 * 1000);
utimesSync(file, old, old);
utimesSync(otherFile, old, old);

// The name a branch topic gets comes from DSH's own projection cache — the same
// place `/sessions` reads a title from.
mkdirSync(join(HOME, 'storages', 'session_projcache', 'sessions'), { recursive: true });
writeFileSync(
  join(HOME, 'storages', 'session_projcache', 'sessions', `session-${SESSION.replace(/^session-/, '')}.json`),
  JSON.stringify({ record: { rows: { title: { val: 'Мой проект' } } } }),
);

process.env.DSH_HOME = HOME;
const { handleControl } = await import('../chat/control.mjs');

const freshState = () => ({ sessions: { '42:7': SESSION }, profiles: {}, lang: {}, titles: {}, reminders: [] });

function context(overrides = {}) {
  const out = [];
  const opened = [];
  const ctx = {
    command: '/branch',
    arg: '',
    chatId: 42,
    threadId: 7,
    key: '42:7',
    state: freshState(),
    config: { profile: 'test' },
    profile: 'test',
    lang: 'ru',
    activeTurns: new Map(),
    saveState: () => {},
    log: () => {},
    send: async () => {},
    reply: (text, extra) => { out.push(text); return 1; },
    sendFile: async () => {},
    stopTurn: () => false,
    seedTopic: async () => {},
    openTopic: async (chatId, name, seed) => { opened.push({ chatId, name, seed }); return 0; },
    jobs: () => ({ active: [], queued: 0, max: 3 }),
    ...overrides,
  };
  return { ctx, out, opened };
}

const run = async (command, arg = '', overrides = {}) => {
  const built = context({ command, arg, ...overrides });
  await handleControl(built.ctx);
  return { ...built, text: built.out.join('\n') };
};

/** Session directories in the project, so a removed copy can be seen to be gone. */
const dirs = () => readdirSync(join(SESSIONS, PROJECT)).sort();

test('the argument picks the form, and a number is not a session id', () => {
  assert.equal(branchTarget('').kind, 'usage');
  assert.equal(branchTarget('   ').kind, 'usage');
  assert.equal(branchTarget('2').kind, 'usage');
  assert.equal(branchTarget('later').kind, 'usage');
  assert.equal(branchTarget('new').kind, 'topic');
  assert.equal(branchTarget('topic').kind, 'topic');
  const bare = branchTarget('3c64c53d-1111-2222-3333-444455556666');
  assert.equal(bare.kind, 'here');
  assert.equal(bare.id, 'session-3c64c53d-1111-2222-3333-444455556666');
  assert.equal(branchTarget('session-3c64c53d-1111-2222-3333-444455556666').id, bare.id);
});

test('/branch with nothing to go on explains both forms and changes nothing', async () => {
  const state = freshState();
  const { text, opened } = await run('/branch', '', { state });
  assert.match(text, /\/branch <id>/);
  assert.match(text, /\/branch new/);
  assert.equal(opened.length, 0, 'a bare /branch opened a topic');
  assert.equal(state.sessions['42:7'], SESSION);
});

test('/branch <id> copies that session into this topic and leaves it whole', async () => {
  const before = readFileSync(otherFile);
  const state = freshState();
  const { text } = await run('/branch', OTHER, { state });
  const made = state.sessions['42:7'];
  assert.match(made, /^session-[0-9a-f-]{36}$/);
  assert.notEqual(made, OTHER);
  assert.match(text, new RegExp(made.slice(8, 16)));
  assert.deepEqual(readFileSync(otherFile), before, 'the source session was modified');
  assert.equal(allTurns(join(SESSIONS, PROJECT, made, 'session.v4.jsonl.zstd')).length, 3, 'the copy lost turns');
  assert.equal(state.forks['42:7'].length, 1, 'the branch was not remembered');
  assert.equal(state.forks['42:7'][0].from, OTHER);
});

test('/branch <id> on a session that is not on disk refuses, and says why', async () => {
  const state = freshState();
  const { text } = await run('/branch', 'session-00000000-0000-0000-0000-000000000000', { state });
  assert.match(text, /нет на диске|not on disk/);
  assert.equal(state.sessions['42:7'], SESSION, 'a refused branch moved the topic');
});

test('/branch new opens a topic on a copy and leaves this one alone', async () => {
  const state = { ...freshState(), cwd: { '42:7': 'C:\\work' }, route: { '42:7': { provider: 'p', model: 'm' } } };
  const opened = [];
  const { text } = await run('/branch', 'new', {
    state,
    openTopic: async (chatId, name, seed) => { opened.push({ chatId, name, seed }); return 99; },
  });
  assert.equal(opened.length, 1, 'no topic was opened');
  assert.equal(opened[0].chatId, '42');
  assert.match(opened[0].name, /Мой проект/);
  assert.match(opened[0].name, /ветка/);
  assert.match(opened[0].seed, /3/, 'the seed does not say how much was copied');
  const made = state.sessions['42:99'];
  assert.match(made, /^session-[0-9a-f-]{36}$/, 'the new topic is not on a copy');
  assert.equal(state.sessions['42:7'], SESSION, 'this topic was moved onto the copy');
  assert.equal(allTurns(join(SESSIONS, PROJECT, made, 'session.v4.jsonl.zstd')).length, 3, 'the copy lost turns');
  assert.match(text, /Мой проект/);
  // The branch is the same work in another place, so the place must not also
  // change the model or the project directory.
  assert.equal(state.cwd['42:99'], 'C:\\work');
  assert.deepEqual(state.route['42:99'], { provider: 'p', model: 'm' });
});

test('a topic Telegram refuses takes the copy with it', async () => {
  const state = freshState();
  const before = dirs();
  const { text } = await run('/branch', 'new', { state });
  assert.match(text, /Тему открыть не вышло|Could not open the topic/);
  assert.equal(state.sessions['42:7'], SESSION, 'a failed branch moved this topic');
  assert.deepEqual(dirs(), before, 'the copy was left behind with nothing pointing at it');
});

test('/branch refuses while a turn is running', async () => {
  const state = freshState();
  const { text } = await run('/branch', 'new', { state, activeTurns: new Map([['42:7', { startedAt: Date.now() }]]) });
  assert.match(text, /идёт ход|turn is running/);
  assert.equal(state.sessions['42:7'], SESSION, 'a busy topic must not be branched');
});
