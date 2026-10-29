// Two topics, two presets, two derived profiles. This is the whole point of the
// per-topic switch: `/permissions` on a bound topic must move that topic and
// leave the neighbour where it was, and the settings card must read the profile
// the topic actually boots rather than the install's.
//
// The sandbox experiments recorded in `permission-rows.mjs` and in the change's
// design.md are the reason this is a test and not a comment: measured with
// `dsh --patch`, the `sandbox-policy` row alone is ignored, `defaultPreset` wins,
// and `workspaceRoot` holds. A future harness change that flips that must fail
// here, not in someone's turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TABLE = `version: 1
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: example-provider
    model: base-model
- id: permission
  name: "@deepseek-ai/dsh-permission-presets"
  config:
    presets:
      read-only:
        sandbox: read-only
        approval: never
      guarded:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
    defaultPreset: danger-full-access
- id: sandbox-policy
  name: "@deepseek-ai/dsh-sandbox-policy"
  config:
    mode: danger-full-access
    workspaceRoot: C:/base
`;

const HOME = mkdtempSync(join(tmpdir(), 'perm-topics-'));
const DIR = join(HOME, 'tg-bridge');
mkdirSync(DIR, { recursive: true });
const BASE = join(HOME, 'profiles', 'headless');
mkdirSync(BASE, { recursive: true });
writeFileSync(join(BASE, 'cordis.patch.yml'), TABLE, 'utf8');
writeFileSync(join(BASE, 'package.json'), JSON.stringify({ name: 'dsh-profile-headless' }), 'utf8');
writeFileSync(join(HOME, 'config.json'), JSON.stringify({ profile: 'headless', lang: 'en' }), 'utf8');
writeFileSync(join(HOME, 'state.json'), JSON.stringify({ offset: 0, sessions: {} }), 'utf8');
writeFileSync(join(DIR, 'state.json'), JSON.stringify({ offset: 0, sessions: {} }), 'utf8');
process.env.DSH_HOME = HOME;

const { state } = await import('../state.mjs');
const { AgentsetStore } = await import('../agentsets.mjs');
const { turnPlan, presetOf, settingsChipOf } = await import('../profile-view.mjs');

/** Two topics on two sets, each asking for a different preset. */
function twoTopics() {
  // The same file `profile-view.mjs` reads: DIR, not the DSH home root.
  const store = new AgentsetStore(join(DIR, 'agentsets.json')).load();
  store.put({ id: 'strict', name: 'Strict', permissions: 'read-only' });
  store.put({ id: 'loose', name: 'Loose', permissions: 'danger-full-access' });
  state.agentsets = { '1:2': 'strict', '1:3': 'loose' };
  state.cwd = {};
  state.wide = {};
  state.settings = {};
  state.profiles = {};
}

const patchOf = (profile) => readFileSync(join(HOME, 'profiles', profile, 'cordis.patch.yml'), 'utf8');

test('two topics with different presets get two profiles and neither reads the other', () => {
  twoTopics();
  const strict = turnPlan('1:2');
  const loose = turnPlan('1:3');
  assert.notEqual(strict.profile, loose.profile);
  assert.match(patchOf(strict.profile), /defaultPreset: read-only/);
  assert.match(patchOf(loose.profile), /defaultPreset: danger-full-access/);
  // The base profile is the same file for both: neither write leaked into it.
  assert.match(patchOf('headless'), /defaultPreset: danger-full-access/);
  // And the card reports each topic's own profile, not the install's.
  assert.equal(presetOf('1:2').profile, strict.profile);
  assert.equal(presetOf('1:2').preset.id, 'read-only');
  assert.equal(presetOf('1:3').preset.id, 'danger-full-access');
});

test('the chip names the set and follows the topic, not the neighbour', () => {
  twoTopics();
  const strict = settingsChipOf('1:2');
  const loose = settingsChipOf('1:3');
  assert.match(strict, /Strict/);
  assert.match(loose, /Loose/);
  assert.notEqual(strict, loose);
});

test('the chat refuses an `ask` preset instead of writing it', async () => {
  twoTopics();
  const { handleControl } = await import('../control.mjs');
  const out = [];
  const before = patchOf('headless');
  const ctx = {
    command: '/permissions',
    arg: 'guarded',
    chatId: 1,
    threadId: 2,
    key: '1:9',
    state: { sessions: {}, profiles: {}, lang: {}, agentsets: {} },
    config: { profile: 'headless', lang: 'en' },
    profile: 'headless',
    lang: 'en',
    activeTurns: new Map(),
    saveState: () => {},
    log: () => {},
    send: async () => {},
    reply: (text) => { out.push(text); return 1; },
    sendFile: async () => {},
    stopTurn: () => false,
    seedTopic: async () => {},
  };
  assert.equal(await handleControl(ctx), true);
  // `approval: ask` fails closed at spawn in a headless turn: writing it would
  // hand the person a preset whose every write dies with "no approval channel".
  assert.match(out.join('\n'), /no approval channel/);
  assert.equal(patchOf('headless'), before);
  // The same preset is still listed, with the reason, so it does not look broken.
  const card = [];
  await handleControl({ ...ctx, arg: '', reply: (text) => { card.push(text); return 1; } });
  assert.match(card.join('\n'), /guarded[\s\S]*cannot be used in a chat/);
});
