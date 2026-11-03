// The subagents panel: what the bridge saw, kept per topic.
//
// The host reports a subagent as a tool call and a later result — no name, no
// tokens, no live progress — so these tests pin the three facts the card is
// allowed to print and the words it uses when it has none.
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// A throwaway home before the bridge's modules load: `/subagents clear` saves
// state, and a test must never rewrite the state of the machine it runs on.
const home = mkdtempSync(join(tmpdir(), 'subagents-'));
process.env.DSH_HOME = home;
const { RUNS_KEEP, forgetRuns, rememberRuns, runsOf, runsSummary } = await import('../work/subagents.mjs');
const { span, subagentsCard } = await import('../chat/subagents-card.mjs');
const { handleSubagentCommands } = await import('../control/cmd-subagents.mjs');
test.after(() => rmSync(home, { recursive: true, force: true }));

const KEY = '1:2';
const fresh = () => ({ subagents: {} });

/** A command context as `chat/control.mjs` builds one, with the reply captured. */
async function run(state, arg = '', lang = 'en') {
  const said = [];
  const claimed = await handleSubagentCommands({
    effective: '/subagents',
    arg,
    lang,
    state,
    key: KEY,
    reply: (text, extra) => said.push({ text, extra }),
  });
  return { claimed, said, text: said.map((one) => one.text).join('\n') };
}

test('runs are stored in order, normalised, and capped', () => {
  const state = fresh();
  rememberRuns(state, KEY, [{ tool: 'subagent', label: '  first\n task ', ms: 4200.4, failed: false }]);
  rememberRuns(state, KEY, [{ tool: 'subagent', label: 'second', ms: 1000, failed: true }]);
  const kept = runsOf(state, KEY);
  assert.deepEqual(kept.map((run) => run.label), ['first task', 'second']);
  assert.equal(kept[0].ms, 4200, 'milliseconds are rounded once, on the way in');
  assert.equal(kept[1].failed, true);

  for (let i = 0; i < RUNS_KEEP + 5; i += 1) rememberRuns(state, KEY, [{ label: `run ${i}`, ms: 10 }]);
  const capped = runsOf(state, KEY);
  assert.equal(capped.length, RUNS_KEEP);
  assert.equal(capped.at(-1).label, `run ${RUNS_KEEP + 4}`, 'the newest run is the one kept');
});

test('a run with no duration is stored as unfinished, not as zero', () => {
  const state = fresh();
  rememberRuns(state, KEY, [{ label: 'still going' }]);
  assert.equal(runsOf(state, KEY)[0].ms, null);
  assert.equal(runsSummary(runsOf(state, KEY)).unfinished, 1);
});

test('reading the runs cannot edit the history by accident', () => {
  const state = fresh();
  rememberRuns(state, KEY, [{ label: 'one', ms: 5 }]);
  runsOf(state, KEY).push({ label: 'invented' });
  runsOf(state, KEY)[0].label = 'changed';
  assert.equal(runsOf(state, KEY).length, 1);
  assert.equal(runsOf(state, KEY)[0].label, 'one');
});

test('forgetting returns how many were dropped and leaves nothing behind', () => {
  const state = fresh();
  rememberRuns(state, KEY, [{ label: 'one', ms: 5 }, { label: 'two', ms: 6 }]);
  assert.equal(forgetRuns(state, KEY), 2);
  assert.deepEqual(runsOf(state, KEY), []);
  assert.equal(forgetRuns(state, KEY), 0, 'forgetting an empty history is not an error');
});

test('the totals count what finished, what failed and what never reported', () => {
  const sum = runsSummary([
    { ms: 1000, failed: false },
    { ms: 2500, failed: true },
    { ms: null, failed: false },
  ]);
  assert.deepEqual(sum, { count: 3, failed: 1, ms: 3500, unfinished: 1 });
  assert.deepEqual(runsSummary([]), { count: 0, failed: 0, ms: 0, unfinished: 0 });
});

test('a duration reads in seconds under a minute and in minutes above it', () => {
  assert.equal(span(0), '0s');
  assert.equal(span(4200), '4s');
  assert.equal(span(74000), '1m 14s');
  assert.equal(span(600000), '10m 00s');
  assert.equal(span(null), '', 'no duration is no text, not a zero');
});

test('an empty panel says so in all three languages and never leaks a key', () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const { text } = subagentsCard(lang, []);
    assert.ok(text.length > 20, lang);
    assert.ok(!text.includes('ctrl.sa.'), `${lang} is missing an empty-state key`);
  }
  assert.match(subagentsCard('en', []).text, /No subagents/);
  assert.match(subagentsCard('ru', []).text, /субагентов/);
});

test('the panel numbers each run, marks failures and names the missing tokens', () => {
  const { text } = subagentsCard('en', [
    { label: 'audit the release', ms: 74000, failed: false },
    { label: '', ms: 3000, failed: true },
    { label: 'still going', ms: null, failed: false },
  ]);
  assert.match(text, /^Subagents in this topic: 3$/m);
  assert.match(text, /^1\. audit the release · 1m 14s$/m);
  assert.match(text, /^2\. \(no description\) · 3s ✖$/m);
  assert.match(text, /^3\. still going · no result$/m);
  assert.match(text, /Total 1m 17s · 1 failed/);
  assert.match(text, /no tokens per subagent/, 'the card says why it has no token counts');
});

test('a long task is shortened on one line, not wrapped into the card', () => {
  const { text } = subagentsCard('en', [{ label: 'x'.repeat(200), ms: 1 }]);
  const row = text.split('\n').find((line) => line.startsWith('1. '));
  const shown = row.slice('1. '.length).split(' · ')[0];
  assert.equal(shown.length, 80, 'one line, ellipsis included');
  assert.ok(shown.endsWith('…'));
});

test('/subagents answers with the panel, its usage, or a cleared history', async () => {
  const state = fresh();
  assert.match((await run(state)).text, /No subagents in this topic yet/);

  rememberRuns(state, KEY, [{ label: 'audit the release', ms: 74000 }]);
  const panel = await run(state);
  assert.equal(panel.claimed, true);
  assert.match(panel.text, /audit the release · 1m 14s/);

  assert.match((await run(state, 'yesterday')).text, /^Usage: \/subagents/);

  const cleared = await run(state, 'clear');
  assert.match(cleared.text, /Forgot 1 subagent run/);
  assert.deepEqual(runsOf(state, KEY), []);
  assert.match((await run(state)).text, /No subagents in this topic yet/);
});

test('another command is not this module to answer', async () => {
  const said = [];
  const claimed = await handleSubagentCommands({
    effective: '/status',
    arg: '',
    lang: 'en',
    state: fresh(),
    key: KEY,
    reply: (text) => said.push(text),
  });
  assert.equal(claimed, false);
  assert.deepEqual(said, []);
});
