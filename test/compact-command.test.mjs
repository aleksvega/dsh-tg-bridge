// `/compact` in the bridge: the command the engine has and the CLI does not.
//
// The reason this file exists is a bug report: typing `/compact` here answered
// "Неизвестная команда", and the honest answer is subtler than either a refusal
// or a pass-through — the engine's manual compaction is a *chat UI* command, and
// the same line sent through the CLI reaches the model as plain text and is
// billed for nothing. These tests pin the card: the threshold this install
// actually runs with, the number that says how close it is, and the one action
// that works here.
import assert from 'node:assert/strict';
import test from 'node:test';

import { compactionThreshold, handleCompactCommands } from '../control/cmd-compact.mjs';

function context(effective, { lang = 'en', session = 'session-abc' } = {}) {
  const out = [];
  const extras = [];
  return {
    ctx: {
      effective,
      lang,
      state: session ? { sessions: { '1:2': session } } : { sessions: {} },
      key: '1:2',
      profile: 'headless',
      reply: (text, extra) => {
        out.push(String(text));
        extras.push(extra || {});
        return 1;
      },
      log: () => {},
    },
    out,
    extras,
  };
}

const deps = (overrides = {}) => ({
  threshold: () => ({ ratio: '0.12', profile: 'headless' }),
  stats: () => ({ contextTokens: 86490, turns: 4 }),
  ...overrides,
});

test('the threshold is read from the live profile patch, not from a default', () => {
  // The patch is found by name, not by absolute path: this suite must not depend
  // on where DSH_HOME points on the machine running it.
  const seen = [];
  const read = (path) => {
    seen.push(path);
    return '  - id: compaction-basic\n    config:\n      auto: true\n      thresholdRatio: 0.12\n';
  };
  const found = compactionThreshold('headless', { read });
  assert.equal(found.ratio, '0.12');
  assert.match(seen[0].replace(/\\/g, '/'), /profiles\/headless\/cordis\.patch\.yml$/);
});

test('a profile with the plugin but no threshold says so instead of borrowing one', () => {
  const read = () => '  - id: compaction-basic\n    config:\n      auto: true\n';
  assert.equal(compactionThreshold('headless', { read }).ratio, '');
});

test('a profile without the plugin is a third answer, not an empty ratio', () => {
  const read = () => '  - id: tool-result-pruner\n';
  assert.equal(compactionThreshold('headless', { read }).ratio, null);
});

test('the card names the ratio, the profile and the size of the context', async () => {
  const { ctx, out } = context('/compact');
  assert.equal(await handleCompactCommands(ctx, deps()), true);
  const card = out[0];
  assert.match(card, /0\.12/);
  assert.match(card, /headless/);
  assert.match(card, /86490 tokens/);
});

test('the card says where manual compaction lives, in the words of the bug', async () => {
  const { ctx, out } = context('/compact');
  await handleCompactCommands(ctx, deps());
  assert.match(out[0], /command of the app chat/);
  assert.match(out[0], /billed and useless/);
  // The refusal quotes the old reply rather than repeating it: the point of the
  // sentence is that "unknown command" was the wrong answer, so the card must be
  // recognisable as an answer to that report.
  assert.match(out[0], /rather than "unknown command"/);
});

test('an empty ratio is a different sentence from a missing plugin', async () => {
  // Both empty and null read as "no threshold set in this profile", and that is
  // the honest sentence for both: what the card may never do is print a default
  // the install does not use.
  const withPlugin = context('/compact');
  await handleCompactCommands(withPlugin.ctx, deps({ threshold: () => ({ ratio: '', profile: 'headless' }) }));
  assert.match(withPlugin.out[0], /sets no compaction threshold/);

  const without = context('/compact');
  await handleCompactCommands(without.ctx, deps({ threshold: () => ({ ratio: null, profile: 'headless' }) }));
  assert.match(without.out[0], /sets no compaction threshold/);

  const found = context('/compact');
  await handleCompactCommands(found.ctx, deps({ threshold: () => ({ ratio: '0.12', profile: 'headless' }) }));
  assert.match(found.out[0], /at 0\.12 of the model window/);
});

test('the one action that works here is a button, and it is a session reset', async () => {
  const { ctx, extras } = context('/compact');
  await handleCompactCommands(ctx, deps());
  assert.equal(extras[0].keyboard[0][0].data, 'cp:new');
});

test('a topic with no session is told there is nothing to condense', async () => {
  const { ctx, out, extras } = context('/compact', { session: '' });
  await handleCompactCommands(ctx, deps());
  assert.equal(out.length, 1);
  assert.match(out[0], /nothing to condense/);
  assert.equal(extras[0].keyboard, undefined, 'no session, no button to press');
});

test('every language answers without leaking a key name', async () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const { ctx, out } = context('/compact', { lang });
    assert.equal(await handleCompactCommands(ctx, deps()), true);
    assert.doesNotMatch(out[0], /ctrl\.compact\./, `${lang} left a key unset`);
    assert.match(out[0], /\S/, `${lang} answered nothing`);
  }
});

test('another command is left to its own handler', async () => {
  const { ctx } = context('/status');
  assert.equal(await handleCompactCommands(ctx, deps()), false);
});
