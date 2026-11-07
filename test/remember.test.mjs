// /remember: the agent's long-term memory, kept where the agent already looks.
//
// The section under test is one part of a file the person owns, so the tests
// lean on the same question every time: did everything around the section
// survive? The handler tests cover the words a person types — list, save,
// forget, and `tidy`, which must hand its job to a real turn instead of
// pretending the bridge can judge what is stale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-remember-'));
const AGENTS = join(HOME, 'AGENTS.md');

/** A hand-written file: person's sections above, agent's memory in the middle. */
function resetAgents() {
  writeFileSync(AGENTS, [
    '# My instructions',
    '',
    '## Rules',
    '- be brief',
    '',
    '## Persona (DSH soul)',
    'short and kind',
    '',
    '## Learned (DSH memory)',
    '- 2026-01-01 — prefers metric units',
    '',
    '## Projects',
    '- old site retired',
    '',
  ].join('\n'), 'utf8');
}

const ORIGINAL_TAIL = '## Projects\n- old site retired\n';

process.env.DSH_HOME = HOME;
const { handleControl } = await import('../chat/control.mjs');
const { appendLearned, learnedOf, setLearned } = await import('../control/agents.mjs');
const { findCommands } = await import('../chat/help-explain.mjs');
const { t } = await import('../core/i18n.mjs');

const freshState = () => ({ sessions: {}, profiles: {}, lang: {}, titles: {}, reminders: [] });

function context(overrides = {}) {
  const out = [];
  const ctx = {
    command: '/remember',
    arg: '',
    chatId: 42,
    threadId: 7,
    key: '42:7',
    state: freshState(),
    config: { profile: 'test', allowedUserIds: [31] },
    profile: 'test',
    lang: 'ru',
    activeTurns: new Map(),
    saveState: () => {},
    log: () => {},
    send: async () => {},
    reply: (text) => { out.push(text); return 1; },
    sendFile: async () => {},
    stopTurn: () => false,
    jobs: () => ({ active: [], queued: 0, max: 3 }),
    ...overrides,
  };
  return { ctx, out };
}

test('a fact lands in the section, dated, with everything around it intact', () => {
  resetAgents();
  const { ctx, out } = context({ arg: 'drinks coffee without sugar' });
  return handleControl(ctx).then((handled) => {
    assert.equal(handled, true);
    assert.match(out[0], /Запомнил/);
    const body = readFileSync(AGENTS, 'utf8');
    // The new fact: dated, inside the learned section, before ## Projects.
    assert.match(body, /- \d{4}-\d{2}-\d{2} — drinks coffee without sugar\n\n## Projects/);
    // The old note survives above it, and the person's own sections too.
    assert.ok(body.includes('- 2026-01-01 — prefers metric units'));
    assert.ok(body.includes('## Rules\n- be brief'));
    assert.ok(body.includes('## Persona (DSH soul)\nshort and kind'));
    assert.ok(body.endsWith(ORIGINAL_TAIL));
    // The one write in the bridge that can lose a person's text always copies first.
    assert.ok(existsSync(`${AGENTS}.bak`));
  });
});

test('no argument lists the memory instead of guessing a job', () => {
  resetAgents();
  const { ctx, out } = context();
  return handleControl(ctx).then((handled) => {
    assert.equal(handled, true);
    assert.match(out[0], /prefers metric units/);
  });
});

test('the cap pushes the oldest notes out and says so', () => {
  resetAgents();
  assert.equal(appendLearned('second').count, 2);
  const { dropped, count } = appendLearned('third', { max: 2 });
  assert.equal(dropped, 1);
  assert.equal(count, 2);
  const learned = learnedOf();
  assert.ok(learned.includes('second'));
  assert.ok(learned.includes('third'));
  assert.ok(!learned.includes('metric units'), 'the oldest note is the one pushed out');
  const body = readFileSync(AGENTS, 'utf8');
  assert.ok(body.endsWith(ORIGINAL_TAIL), 'the sections after the memory must not move');
});

test('forget erases whole lines by word, and only those', () => {
  resetAgents();
  appendLearned('drinks coffee without sugar');
  const { ctx, out } = context({ arg: 'forget coffee' });
  return handleControl(ctx).then((handled) => {
    assert.equal(handled, true);
    assert.match(out[0], /Стёр 1/);
    const body = readFileSync(AGENTS, 'utf8');
    assert.ok(!body.includes('coffee'));
    assert.ok(body.includes('prefers metric units'));
    assert.ok(body.endsWith(ORIGINAL_TAIL));
  });
});

test('forget all removes the section and keeps the file', () => {
  resetAgents();
  const { ctx, out } = context({ arg: 'forget all' });
  return handleControl(ctx).then((handled) => {
    assert.equal(handled, true);
    assert.match(out[0], /очищена/);
    const body = readFileSync(AGENTS, 'utf8');
    assert.ok(!body.includes('Learned'));
    assert.ok(body.includes('## Rules'));
    assert.ok(body.includes('## Persona (DSH soul)\nshort and kind'));
    assert.ok(body.endsWith(ORIGINAL_TAIL));
  });
});

test('forget of a word that is not there changes nothing', () => {
  resetAgents();
  const before = readFileSync(AGENTS, 'utf8');
  const { ctx, out } = context({ arg: 'forget yoga' });
  return handleControl(ctx).then((handled) => {
    assert.equal(handled, true);
    assert.match(out[0], /не нашлось/);
    assert.equal(readFileSync(AGENTS, 'utf8'), before);
  });
});

test('tidy hands the job to a real turn, through the topic queue', () => {
  resetAgents();
  const delivered = [];
  const { ctx, out } = context({
    arg: 'tidy',
    redeliver: (key, message) => { delivered.push({ key, message }); },
  });
  return handleControl(ctx).then((handled) => {
    assert.equal(handled, true);
    assert.match(out[0], /Запустил ход/);
    assert.equal(delivered.length, 1);
    assert.equal(delivered[0].key, '42:7');
    // A synthetic message the turn path accepts: chat, owner, thread, text.
    const message = delivered[0].message;
    assert.equal(message.chat.id, 42);
    assert.equal(message.from.id, 31);
    assert.equal(message.message_thread_id, 7);
    assert.equal(message.text, t('ru', 'ctrl.remember.task'));
    // The tidy command itself did not touch the memory — that is the turn's job.
    assert.ok(readFileSync(AGENTS, 'utf8').includes('prefers metric units'));
  });
});

test('tidy without a turn behind it refuses instead of pretending', () => {
  resetAgents();
  const { ctx, out } = context({ arg: 'tidy' });
  return handleControl(ctx).then((handled) => {
    assert.equal(handled, true);
    assert.match(out[0], /руками/);
    assert.ok(readFileSync(AGENTS, 'utf8').includes('prefers metric units'));
  });
});

test('setLearned rebuilds the section from whole lines', () => {
  resetAgents();
  assert.equal(setLearned('- one\n- two'), true);
  assert.equal(learnedOf(), '- one\n- two');
  assert.ok(readFileSync(AGENTS, 'utf8').endsWith(ORIGINAL_TAIL));
  // An empty replacement removes the section; a no-op stays a no-op.
  assert.equal(setLearned(''), true);
  assert.equal(learnedOf(), '');
  assert.equal(setLearned(''), false);
});

test('help finds /remember by the words people use for memory', () => {
  assert.ok(findCommands('память', 'ru', t).includes('remember'));
  assert.ok(findCommands('memory', 'en', t).includes('remember'));
  assert.ok(findCommands('记忆', 'zh', t).includes('remember'));
});
