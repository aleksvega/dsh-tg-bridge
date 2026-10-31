// The Jev gate has to be right about two things or it is worse than nothing: what
// it refuses, and when it stays out of the way. A gate that blocks a commit over
// a probabilistic hunch teaches `--no-verify`, and a gate that skips silently on a
// working machine is a decoration.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FAIL_SECURITY, FAIL_SEVERITY, parseReport, runJevGate, verdict } from '../jev-gate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const REPORT = `# jev-qa report — 2026-10-31T14:00:00.000Z

Scope: 3 files · stage1 syntax errors: 1 · stage2 flagged: 2 · Jev calls: 2 in 4000 ms

## Syntax errors (stage 1, free)
- **chat/broken.mjs** — \`SyntaxError: Unexpected token\`

## Semantic flags (stage 2, Jev) — sorted by risk

| file | bug | sev | risk | err-handling | security | logic | ms |
|---|---|---|---|---|---|---|---|
| chat/leaky.mjs | 0.9 | 5 | 4.5 | 0.2 | 0.9 | 0.1 | 900 |
| chat/meh.mjs | 0.6 | 2 | 1.2 | 0.3 | 0.1 | 0.2 | 800 |
`;

test('a report becomes numbers', () => {
  const { syntax, rows } = parseReport(REPORT);
  assert.equal(syntax.length, 1);
  assert.equal(syntax[0].file, 'chat/broken.mjs');
  assert.match(syntax[0].error, /Unexpected token/);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].severity, 5);
  assert.equal(rows[0].security, 0.9);
  assert.equal(rows[1].file, 'chat/meh.mjs');
});

test('a clean report is a pass with nothing to say', () => {
  const decided = verdict(parseReport('No issues flagged.'));
  assert.deepEqual(decided, { ok: true, reasons: [], advice: [] });
});

test('a syntax error fails: it is free to check and never a judgement call', () => {
  const decided = verdict(parseReport(REPORT));
  assert.equal(decided.ok, false);
  assert.ok(decided.reasons.some((r) => r.includes('syntax error')));
});

test('severity and security fail at the documented lines, and nothing else does', () => {
  const row = (severity, security) => verdict({ syntax: [], rows: [{ file: 'a.mjs', hasBug: 0.9, severity, risk: 2, security, logic: 0 }] });
  assert.equal(row(FAIL_SEVERITY, 0).ok, false);
  assert.equal(row(FAIL_SEVERITY - 1, FAIL_SECURITY - 0.1).ok, true, 'a hunch is advice, not a refusal');
  assert.equal(row(2, FAIL_SECURITY).ok, false, 'a security flag blocks whatever the severity says');
  // The numbers a person sees must be the ones that decided it.
  assert.match(row(4, 0).reasons[0], /severity 4\/5/);
  assert.match(row(2, 0.85).reasons[0], /security risk 0\.85/);
});

test('a flagged file that did not block still gets a line of advice', () => {
  const decided = verdict(parseReport(REPORT));
  assert.ok(decided.advice.some((line) => line.includes('chat/meh.mjs')));
  assert.ok(!decided.advice.some((line) => line.includes('chat/leaky.mjs')), 'blocking findings are not repeated as advice');
});

test('no key means no call at all', () => {
  let ran = 0;
  const result = runJevGate({ root: '.', env: {}, run: () => { ran += 1; return { status: 0, stdout: '' }; } });
  assert.equal(result.status, 'skip');
  assert.equal(ran, 0, 'the hook must not spend a call it cannot make');
  assert.match(result.reason, /JEV_API_KEY/);
});

test('a machine whose tools read JEV_API_KEY still works', () => {
  const result = runJevGate({
    root: '.',
    env: { JEV_API_KEY: 'x' },
    run: () => ({ status: 0, stdout: 'jev-qa: no changed code files\n' }),
  });
  assert.equal(result.status, 'pass');
});

test('the key reaches the tool under the name it reads', () => {
  let seen = null;
  runJevGate({
    root: '.',
    env: { JEV_API_KEY: 'from-user-env' },
    run: (name, args, options) => {
      seen = { name, args, options };
      return { status: 0, stdout: 'No issues flagged.' };
    },
  });
  assert.equal(seen.name, 'jev-qa');
  assert.deepEqual(seen.args.slice(0, 2), ['.', '--diff']);
  assert.equal(seen.options.env.OPENROUTER_API_KEY, 'from-user-env');
});

test('a missing tool, a timeout or an empty answer skips instead of blocking', () => {
  const base = { root: '.', env: { JEV_API_KEY: 'x' } };
  assert.match(runJevGate({ ...base, run: () => ({ error: { code: 'ENOENT' } }) }).reason, /not installed/);
  assert.match(runJevGate({ ...base, run: () => ({ signal: 'SIGTERM' }) }).reason, /in time/);
  assert.match(runJevGate({ ...base, run: () => ({ status: 0, stdout: '' }) }).reason, /no report/);
  const threw = runJevGate({ ...base, run: () => { throw new Error('spawn failed'); } });
  assert.equal(threw.status, 'skip');
  assert.equal(runJevGate({ root: '.', env: { JEV_API_KEY: 'x', DSH_SKIP_JEV: '1' }, run: () => { throw new Error('must not run'); } }).status, 'skip');
});

test('the gate runs after the secret scan, from the generated hook and from the generator', () => {
  for (const path of [join(ROOT, '.githooks', 'pre-commit'), join(ROOT, 'install-hooks.mjs')]) {
    const text = readFileSync(path, 'utf8');
    const scan = text.indexOf('scan-secrets.mjs');
    const gate = text.indexOf('jev-gate.mjs');
    assert.ok(scan !== -1 && gate !== -1, `${path} must name both checks`);
    assert.ok(scan < gate, `${path}: the free, deterministic check runs first`);
  }
});