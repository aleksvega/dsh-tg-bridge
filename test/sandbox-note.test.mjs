// A sandbox refusal is a decision, not a crash.
//
// The CLI writes three different `[sandbox: …]` lines into a failed tool result,
// and they mean three different things. All three used to reach the chat as
// "сбой хода" — the word that sends someone to the log for a policy they chose
// themselves, or worse, makes them think the bot is broken. This module is the
// only thing standing between a marker and that message, so every marker, every
// language and the "nothing to say" case are tested.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxMarker, sandboxNote, sandboxRefusals, turnSandboxNote, reportRefusals } from '../sandbox-note.mjs';
import { t } from '../i18n.mjs';

const LANGS = ['en', 'ru', 'zh'];

const DENIED = 'bash failed\n[sandbox: file access denied under workspace-write mode]';
const ESCALATION = '[sandbox: file access denied under read-only mode]\n[sandbox: escalation available — retry this exact command once with sandbox_permissions (the narrowest wider mode that suffices) + justification; the approval prompt asks the user]';
const RUNNER = '[sandbox: the sandbox runner itself failed under read-only mode — the command did not run; this is a sandbox problem, not a command failure]';

test('each marker is recognised as itself', () => {
  assert.deepEqual(sandboxMarker(DENIED), { kind: 'denied', mode: 'workspace-write' });
  // The escalation line rides along with a denial; the denial is the fact.
  assert.deepEqual(sandboxMarker(ESCALATION), { kind: 'denied', mode: 'read-only' });
  assert.deepEqual(sandboxMarker(RUNNER), { kind: 'runner', mode: 'read-only' });
});

test('ordinary text is not a refusal', () => {
  // The one case that matters most: a clean turn must produce no notice at all.
  assert.equal(sandboxMarker('all good'), null);
  assert.equal(sandboxMarker(''), null);
  assert.equal(sandboxMarker(null), null);
  assert.equal(sandboxMarker(undefined), null);
  // A mention of the word without the marker is a model talking about sandboxes.
  assert.equal(sandboxMarker('the sandbox refused to write, so I changed approach'), null);
});

test('an unknown marker still says "sandbox", never "crash"', () => {
  const marker = sandboxMarker('[sandbox: something this build has never seen]');
  assert.deepEqual(marker, { kind: 'denied', mode: '' });
});

test('every language explains a refusal, and offers the switch', () => {
  for (const lang of LANGS) {
    for (const marker of [{ kind: 'denied', mode: 'read-only' }, { kind: 'runner', mode: 'workspace-write' }]) {
      const { text, keyboard } = sandboxNote(marker, lang);
      assert.ok(text.length > 0, `${lang} ${marker.kind} said nothing`);
      assert.doesNotMatch(text, /\{\w+\}/, `${lang} ${marker.kind} left a placeholder: ${text}`);
      assert.match(text, /read-only|workspace-write/, `${lang} lost the mode`);
      // The button is the whole point: the fix is a policy change, and the person
      // should not have to remember the command name after being refused.
      const row = keyboard.inline_keyboard.flat();
      assert.equal(row.length, 1, `${lang} drew ${row.length} buttons`);
      assert.equal(row[0].callback_data, 'mn:permissions');
      assert.ok(row[0].text.length > 0, `${lang} drew an empty button`);
      // A refusal must not be described as a failure of the task.
      assert.doesNotMatch(text, /ошибка|сбой|failed to run the task/i, `${lang} blamed the task: ${text}`);
    }
  }
});

test('a broken runner is not the same sentence as a policy that worked', () => {
  const denied = sandboxNote({ kind: 'denied', mode: 'read-only' }, 'en').text;
  const runner = sandboxNote({ kind: 'runner', mode: 'read-only' }, 'en').text;
  assert.notEqual(denied, runner);
  // The distinction the person needs: a denial means nothing ran and the policy
  // is fine; a runner failure means the confinement itself is broken.
  assert.match(runner, /never ran|did not run/i);
  assert.match(denied, /policy/i);
});

test('refusals are counted per distinct wall, not per attempt', () => {
  const results = [
    { tool: 'bash', result: DENIED },
    { tool: 'bash', result: DENIED },
    { tool: 'bash', result: RUNNER },
    { tool: 'read', result: 'fine' },
  ];
  const refusals = sandboxRefusals(results);
  assert.equal(refusals.length, 2, 'one row per distinct marker');
  assert.equal(refusals[0].count, 2);
  assert.equal(refusals[0].tool, 'bash');
  assert.equal(refusals[1].kind, 'runner');
  // Nothing refused means nothing reported.
  assert.deepEqual(sandboxRefusals([{ tool: 'bash', result: 'ok' }]), []);
  assert.deepEqual(sandboxRefusals([]), []);
  assert.deepEqual(sandboxRefusals(null), []);
});

test('a turn note names the worst thing that happened, and how often', () => {
  const one = turnSandboxNote([{ kind: 'denied', mode: 'read-only', count: 1 }], 'en');
  assert.match(one.text, /policy/i);
  assert.doesNotMatch(one.text, /times/, 'a single refusal is not counted out loud');
  // Three refusals get a count: it tells the person this was not a one-off.
  const many = turnSandboxNote([{ kind: 'denied', mode: 'read-only', count: 3 }], 'en');
  assert.match(many.text, /3/);
  // A runner failure outranks a denial in the same turn.
  const both = turnSandboxNote([
    { kind: 'denied', mode: 'read-only', count: 1 },
    { kind: 'runner', mode: 'workspace-write', count: 1 },
  ], 'en');
  assert.match(both.text, /never ran|did not run/i);
  // A clean turn says nothing at all — this is the common case.
  assert.equal(turnSandboxNote([], 'en'), null);
  assert.equal(turnSandboxNote(null, 'en'), null);
});

test('the notice goes out once, and its failure cannot fail the turn', async () => {
  const sent = [];
  const said = await reportRefusals({
    refusals: [{ tool: 'bash', result: DENIED }],
    lang: 'ru',
    log: () => {},
    where: 'chat:1',
    send: async (text, keyboard) => { sent.push({ text, keyboard }); },
  });
  assert.equal(said, true);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].keyboard.inline_keyboard.length > 0);

  // No refusals: no message, and no call at all.
  const quiet = await reportRefusals({ refusals: [], lang: 'ru', log: () => {}, send: async () => { throw new Error('must not be called'); } });
  assert.equal(quiet, false);

  // Telegram refusing the notice is a log line, not a failed turn.
  const logged = [];
  const survived = await reportRefusals({
    refusals: [{ tool: 'bash', result: DENIED }],
    lang: 'en',
    log: (line) => logged.push(line),
    send: async () => { throw new Error('400 Bad Request'); },
  });
  assert.equal(survived, true);
  assert.ok(logged.some((line) => /sandbox notice failed/.test(line)), 'the failure was not logged');
});

test('the strings the notice asks for exist in every language', () => {
  for (const lang of LANGS) {
    for (const key of ['sandbox.denied', 'sandbox.runner', 'sandbox.open', 'sandbox.times']) {
      const text = t(lang, key, { mode: 'read-only', n: 3 });
      assert.ok(text && text !== key, `${lang} is missing ${key}`);
      assert.doesNotMatch(text, /\{\w+\}/, `${lang} ${key} left a placeholder`);
    }
  }
});
