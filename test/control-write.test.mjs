import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The control module resolves DSH_HOME at import time, so the fixture has to be
// in place before the dynamic import below. Each test file runs in its own
// process, which is what makes that safe.
const HOME = mkdtempSync(join(tmpdir(), 'dsh-bridge-write-'));
const PROFILE = 'test';
const DIR = join(HOME, 'profiles', PROFILE);
mkdirSync(DIR, { recursive: true });

const PATCH = `# A small profile with the three rows these commands edit.
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: test
    model: test-one
    models:
      - id: test-one
        reasoningEfforts:
          off: {}
          low: {}
          high: {}
      - id: test-two
- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    defaultPreset: workspace-write
    presets:
      read-only:
        sandbox: read-only
        approval: never
      workspace-write:
        sandbox: workspace-write
        approval: never
      danger-full-access:
        sandbox: danger-full-access
        approval: never
- id: tool-subagent
  name: "@deepseek-ai/dsh-tool-subagent"
  config:
    provider: spawn
    toolName: subagent
    agentOptions:
      model: test-one
`;

writeFileSync(join(DIR, 'cordis.patch.yml'), PATCH, 'utf8');
writeFileSync(join(DIR, 'package.json'), JSON.stringify({
  name: 'dsh-profile-test',
  dependencies: {},
  dsh: { profile: { bundles: [] } },
}, null, 2), 'utf8');

process.env.DSH_HOME = HOME;

const { handleControl } = await import('../control.mjs');

const patch = () => readFileSync(join(DIR, 'cordis.patch.yml'), 'utf8');

/** A control context that records replies instead of sending them. */
function context(overrides = {}) {
  const out = [];
  const ctx = {
    command: '/help',
    arg: '',
    chatId: 42,
    threadId: 7,
    key: '42:7',
    state: { sessions: {}, profiles: {}, lang: {}, titles: {}, reminders: [] },
    config: { profile: PROFILE },
    profile: PROFILE,
    lang: 'ru',
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

const run = async (command, arg = '', overrides = {}) => {
  const built = context({ command, arg, ...overrides });
  const handled = await handleControl(built.ctx);
  return { ...built, handled, text: built.out.join('\n') };
};

test('/effort writes a value the route declares and reads it back', async () => {
  const set = await run('/effort', 'high');
  assert.match(set.text, /high/);
  assert.match(patch(), /^ {4}reasoningEffort: high$/m);
  const card = await run('/effort');
  assert.match(card.text, /high/);
});

test('/effort refuses an id the route does not declare', async () => {
  const before = patch();
  const { text } = await run('/effort', 'ultra');
  assert.match(text, /ultra/);
  assert.equal(patch(), before);
});

test('/effort off removes the key and says so once', async () => {
  await run('/effort', 'low');
  assert.match(patch(), /reasoningEffort: low/);
  const off = await run('/effort', 'off');
  assert.doesNotMatch(off.text, /off для профиля|off for profile/);
  assert.doesNotMatch(patch(), /reasoningEffort:/);
  const again = await run('/effort', 'off');
  assert.match(again.text, /Уже так|Already/);
});

test('/permissions lists the table, marks the current preset and switches', async () => {
  const card = await run('/permissions');
  assert.match(card.text, /workspace-write/);
  assert.match(card.text, /read-only/);
  const switched = await run('/permissions', 'read-only');
  assert.match(switched.text, /read-only/);
  assert.match(patch(), /defaultPreset: read-only/);
  const after = await run('/permissions');
  assert.match(after.text, /Стартовый пресет: read-only|Starting preset: read-only/);
});

test('/permissions refuses a name outside the table without touching the file', async () => {
  const before = patch();
  const { text } = await run('/permissions', 'god-mode');
  assert.match(text, /god-mode/);
  assert.equal(patch(), before);
});

test('/agents set depth writes one row and default removes the key', async () => {
  const set = await run('/agents', 'set depth 4 @subagent');
  assert.match(set.text, /глубина 4|depth 4/);
  assert.match(patch(), /^ {4}maxDepth: 4$/m);
  await run('/agents', 'set depth default @subagent');
  assert.doesNotMatch(patch(), /maxDepth/);
});

test('/agents set filter keeps every entry, including a name that is also a tool', async () => {
  const set = await run('/agents', 'set filter bash,subagent');
  assert.match(set.text, /запрещено инструментов 2|denied tools 2/);
  assert.match(patch(), /^ {6}deny:\n {8}- bash\n {8}- subagent$/m);
  await run('/agents', 'set filter none @subagent');
  assert.doesNotMatch(patch(), /toolFilter/);
});

test('/agents set model targets the delegation row, not the session route', async () => {
  await run('/agents', 'set model test-two @subagent');
  assert.match(patch(), /agentOptions:\n {6}model: test-two/);
  assert.match(patch(), /^ {4}model: test-one$/m, 'the session model must not move');
});

test('/agents set names an unknown row instead of silently doing nothing', async () => {
  const before = patch();
  const { text } = await run('/agents', 'set depth 2 @subagent_fork');
  assert.match(text, /@subagent_fork/);
  assert.equal(patch(), before);
});

test('/jobs reports the bridge turns, not a DSH job list', async () => {
  const { text } = await run('/jobs', '', {
    jobs: () => ({ active: [{ key: '42:7', startedAt: Date.now() - 120_000 }], queued: 2, max: 3 }),
  });
  assert.match(text, /2/);
  assert.match(text, /эта тема|this topic/);
});

test('/plan never claims a state the session did not record', async () => {
  const { text } = await run('/plan');
  assert.match(text, /не записала|has not recorded/);
  assert.match(text, /покажи план|show the plan/);
});

test('/preset explains a profile that declares none', async () => {
  const { text } = await run('/preset');
  assert.match(text, /не объявляет пресетов|declares no agent presets/);
});

test('/remind adds, lists, deletes and clears in this chat only', async () => {
  const state = { sessions: {}, profiles: {}, lang: {}, titles: {}, reminders: [] };
  const added = await run('/remind', '+10m проверить', { state });
  assert.match(added.text, /проверить/);
  assert.equal(state.reminders.length, 1);
  assert.equal(state.reminders[0].chatId, '42');
  const listed = await run('/remind', '', { state });
  assert.match(listed.text, /1\./);
  assert.match(listed.text, /проверить/);
  const other = await run('/remind', '', { state, chatId: 99, key: '99:1' });
  assert.match(other.text, /Ничего не запланировано|Nothing scheduled/);
  const removed = await run('/remind', 'del 1', { state });
  assert.match(removed.text, /проверить/);
  assert.equal(state.reminders.length, 0);
});

test('/remind refuses a time it cannot read and keeps the store empty', async () => {
  const { text, ctx } = await run('/remind', 'soon please');
  assert.match(text, /\+15m|09:30/);
  assert.equal((ctx.state.reminders || []).length, 0);
});

test('/remind caps a chat at 20 entries', async () => {
  const state = { sessions: {}, profiles: {}, lang: {}, titles: {}, reminders: [] };
  for (let i = 0; i < 20; i += 1) {
    state.reminders.push({ id: `r${i}`, chatId: '42', threadId: 7, at: Date.now() + 60_000 + i, text: `n${i}`, lang: 'ru' });
  }
  const { text } = await run('/remind', '+30m ещё', { state });
  assert.match(text, /20/);
  assert.equal(state.reminders.length, 20);
});
