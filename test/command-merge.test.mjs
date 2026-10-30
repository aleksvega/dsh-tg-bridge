// One verb per job, and the argument picks the variant.
//
// The lookalike pairs are gone from `/help` and the panel: going back is
// `/rewind` with a word (`fork`, `branches`), switching a session is
// `/sessions <id>`, and "am I current?" is `/update`. The old names still have
// to work — an instruction written down months ago must not become a full AI
// turn — so this file checks both halves: the rewrite, and the silence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSession } from './rewind-fixture.mjs';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-merge-'));
const PROJECT = 'c-Users-test-project';
const SESSION = 'session-test';
const SESSIONS = join(HOME, 'sessions');
mkdirSync(join(SESSIONS, PROJECT, SESSION), { recursive: true });
const fixture = writeSession([
  { user: 'one', answer: 'A' },
  { user: 'two', answer: 'B' },
]);
const file = join(SESSIONS, PROJECT, SESSION, 'session.v4.jsonl.zstd');
copyFileSync(fixture.file, file);
const old = new Date(Date.now() - 10 * 60 * 1000);
utimesSync(file, old, old);

process.env.DSH_HOME = HOME;
const { handleControl } = await import('../chat/control.mjs');
const { DOCUMENTED_COMMANDS, MENU_COMMANDS } = await import('../chat/commands-registry.mjs');
const { menuCommands } = await import('../chat/menu-card.mjs');
const { explainCommand } = await import('../chat/help-explain.mjs');
const { t } = await import('../core/i18n.mjs');

function context(overrides = {}) {
  const out = [];
  const cards = [];
  const logs = [];
  const ctx = {
    command: '/status',
    arg: '',
    chatId: 42,
    threadId: 7,
    key: '42:7',
    state: { sessions: { '42:7': SESSION }, profiles: {}, lang: {}, titles: {}, reminders: [] },
    config: { profile: 'test' },
    profile: 'test',
    lang: 'ru',
    activeTurns: new Map(),
    saveState: () => {},
    log: (line) => logs.push(String(line)),
    send: async () => {},
    reply: (text, extra) => { out.push(text); cards.push(extra || {}); return 1; },
    sendFile: async () => {},
    stopTurn: () => false,
    seedTopic: async () => {},
    jobs: () => ({ active: [], queued: 0, max: 3 }),
    ...overrides,
  };
  return { ctx, out, cards, logs };
}

const run = async (command, arg = '', overrides = {}) => {
  const built = context({ command, arg, ...overrides });
  await handleControl(built.ctx);
  return { ...built, text: built.out.join('\n') };
};

test('/rewind fork is the same work as the old /fork', async () => {
  const state = { sessions: { '42:7': SESSION }, profiles: {}, lang: {}, titles: {}, reminders: [] };
  const { text } = await run('/rewind', 'fork', { state });
  assert.match(text, /ветк|branch/i);
  assert.notEqual(state.sessions['42:7'], SESSION, 'the topic did not move onto the copy');
});

test('/rewind branches lists what /rewind fork made', async () => {
  const state = { sessions: { '42:7': SESSION }, profiles: {}, lang: {}, titles: {}, reminders: [] };
  const made = (await run('/rewind', 'fork', { state })).ctx.state.sessions['42:7'];
  const list = await run('/rewind', 'branches', { state });
  const buttons = (list.cards.at(-1).keyboard || []).flat();
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].data, `fk:${made}`, 'the button does not name the branch');
});

test('the old spellings still do the same job, and say so in the log', async () => {
  const state = { sessions: { '42:7': SESSION }, profiles: {}, lang: {}, titles: {}, reminders: [] };
  const forked = await run('/fork', '', { state });
  assert.match(forked.text, /ветк|branch/i);
  assert.ok(forked.logs.some((line) => line.includes('/fork') && line.includes('/rewind fork')), 'the rewrite is not logged');
  const listed = await run('/branches', '', { state });
  assert.equal((listed.cards.at(-1).keyboard || []).flat().length, 1);
});

test('/sessions <id> continues a session, /sessions 5 still means five', async () => {
  const state = { sessions: {}, profiles: {}, lang: {}, titles: {}, reminders: [] };
  const switched = await run('/sessions', 'abc123', { state });
  assert.equal(state.sessions['42:7'], 'session-abc123');
  assert.match(switched.text, /session-abc123/);
  // A number is a count, not an id: the list must not switch anything.
  const after = { sessions: { '42:7': SESSION }, profiles: {}, lang: {}, titles: {}, reminders: [] };
  await run('/sessions', '5', { state: after });
  assert.equal(after.sessions['42:7'], SESSION, 'a count was taken for a session id');
});

test('/version is /update now, and one card answers both questions', async () => {
  const viaOld = await run('/version', '');
  const viaNew = await run('/update', '');
  assert.match(viaNew.text, /1\.\d+\.\d+|npm|version|Версия/i);
  assert.equal(viaOld.text, viaNew.text, '/version and /update disagree');
});

test('no merged name is advertised anywhere a person reads', () => {
  for (const name of ['fork', 'branches', 'resume', 'version']) {
    assert.ok(!DOCUMENTED_COMMANDS.includes(name), `${name} is still documented`);
    assert.ok(!MENU_COMMANDS.includes(name), `${name} is still in the Telegram menu`);
    assert.ok(!menuCommands().includes(name), `${name} is still a panel button`);
  }
});

test('/help on a merged name explains the command that owns the job', () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const about = explainCommand('fork', lang, t);
    assert.match(about, /rewind/, `${lang} does not point at /rewind`);
    assert.doesNotMatch(about, /^ctrl\.help\.about\./, `${lang} has no text for it`);
  }
});
