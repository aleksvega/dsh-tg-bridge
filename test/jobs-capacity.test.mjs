// The parallel ceiling is a setting a person must be able to reach from the
// chat. It used to be a config-file key only: a machine with three long turns
// answered a fourth topic with "waiting for a free slot" and there was nothing
// to widen it with. `/jobs` shows the queue, so the number lives there — as an
// argument and as a row of buttons, both writing the same value.
import test from 'node:test';
import assert from 'node:assert/strict';
import './sandbox-home.mjs';
import { handleControl } from '../chat/control.mjs';
import { inlineKeyboard } from '../chat/telegram.mjs';
import { CAP_CHOICES, CAP_MAX, CAP_MIN } from '../work/jobs-cap.mjs';
import { maxParallel } from '../turn/queue.mjs';
import { config } from '../core/state.mjs';

/** The smallest context `/jobs` needs, with the config write recorded. */
function context({ arg = '', max = 3, write = true } = {}) {
  const said = [];
  const extra = [];
  const saves = [];
  const reply = (text, opts) => {
    said.push(String(text ?? ''));
    if (opts) extra.push(opts);
    return Promise.resolve(0);
  };
  return {
    said,
    extra,
    saves,
    ctx: {
      command: '/jobs',
      arg,
      text: `/jobs ${arg}`.trim(),
      lang: 'en',
      chatId: 1,
      threadId: 0,
      key: '1:0',
      state: { sessions: {}, lang: {} },
      config: { profile: 'headless', lang: 'en', maxParallel: max },
      activeTurns: new Map(),
      saveState: () => {},
      saveConfig: () => {
        saves.push('config');
        return write;
      },
      log: () => {},
      send: reply,
      reply,
      api: async () => ({}),
      sendFile: async () => {},
      jobs: () => ({ active: [], queued: 0, max }),
      profile: 'headless',
      prices: () => 'prices',
      stopTurn: () => false,
    },
  };
}

test('/jobs shows the current ceiling and a button per value', async () => {
  const run = context({ max: 3 });
  await handleControl(run.ctx);
  const text = run.said.join('\n');
  assert.match(text, /Parallel turns at once: 3/, 'the card states the ceiling');
  assert.match(text, /\/jobs 5/, 'and how to set it by typing');

  const rows = inlineKeyboard(run.extra.at(-1).keyboard);
  assert.equal(rows.length, 1, 'one row, so a thumb never hits the neighbour');
  const values = rows[0].map((b) => b.callback_data);
  assert.deepEqual(values, ['jb:1', 'jb:2', 'jb:3', 'jb:4', 'jb:6', 'jb:8', 'jb:10', 'jb:12']);
  // The value in force is marked, not hidden: the card must answer "what is it
  // now" without a second read.
  assert.equal(rows[0][2].text, '• 3');
  assert.equal(rows[0][0].text, '1');
});

test('/jobs <n> sets the ceiling and says it was saved', async () => {
  const run = context({ arg: '5' });
  await handleControl(run.ctx);
  assert.equal(run.ctx.config.maxParallel, 5, 'the live config is what the queue reads');
  assert.deepEqual(run.saves, ['config'], 'the value is persisted, not only held');
  assert.match(run.said.join('\n'), /Parallel turns at once: 5/);
  assert.match(run.said.join('\n'), /config\.json/, 'it says where the number lives');
});

test('a failed write is reported, not hidden', async () => {
  // The setting still applies to this process — saying so is the honest answer;
  // silently pretending it was saved makes a restart look like a bug.
  const run = context({ arg: '5', write: false });
  await handleControl(run.ctx);
  assert.equal(run.ctx.config.maxParallel, 5);
  assert.match(run.said.join('\n'), /this process only/);
  assert.match(run.said.join('\n'), /restart/);
});

test('a number outside 1..12 changes nothing', async () => {
  for (const bad of ['0', '13', '-1', '2.5', 'many', '100']) {
    const run = context({ arg: bad });
    await handleControl(run.ctx);
    assert.equal(run.ctx.config.maxParallel, 3, `/jobs ${bad} moved the ceiling`);
    assert.deepEqual(run.saves, [], `/jobs ${bad} wrote config.json`);
    assert.match(run.said.join('\n'), /1 to 12/, `/jobs ${bad} did not explain the range`);
  }
});

test('twelve is the ceiling and every offered button is inside it', async () => {
  // The person asked for twelve parallel turns; the command must accept it and
  // the card must be able to reach it by tap, or the number exists only in docs.
  const top = context({ arg: '12' });
  await handleControl(top.ctx);
  assert.equal(top.ctx.config.maxParallel, 12, '/jobs 12 was refused');
  assert.match(top.said.join('\n'), /Parallel turns at once: 12/);

  for (const n of CAP_CHOICES) {
    assert.ok(n >= CAP_MIN && n <= CAP_MAX, `the card offers ${n}, outside 1..${CAP_MAX}`);
  }
  assert.ok(CAP_CHOICES.includes(CAP_MAX), 'the card cannot reach the ceiling');
});

test('the queue honours twelve and refuses more than a hand-edited config allows', () => {
  // The clamp in the queue is the last line of defence: a config.json edited by
  // hand must not turn into twenty Electron children.
  const keep = config.maxParallel;
  try {
    config.maxParallel = 12;
    assert.equal(maxParallel(), 12);
    config.maxParallel = 20;
    assert.equal(maxParallel(), 12, 'the queue let a hand-edited 20 through');
    config.maxParallel = 0;
    assert.equal(maxParallel(), 1, 'the queue let a zero through');
    config.maxParallel = undefined;
    assert.equal(maxParallel(), 3, 'an unset cap is the old default');
  } finally {
    config.maxParallel = keep;
  }
});

test('the card says the same thing in every language', async () => {
  for (const lang of ['en', 'ru', 'zh']) {
    const run = context();
    run.ctx.lang = lang;
    await handleControl(run.ctx);
    assert.ok(run.said.join('\n').length > 40, `${lang} said nothing useful`);
  }
});
