// The load card and the guard behind it.
//
// The bridge runs on somebody's desktop, next to whatever else that desktop is
// for. Two things had to be true before this could ship: the numbers have to be
// the same ones Task Manager shows (so a warning can be checked), and the guard
// must hold a prompt rather than refuse it — a bot that answers "come back
// later" to a person who asked for work is a bot that lost the work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { breaches, driveOf, guardOf, held, hold, round1, takeHeld } from '../machine.mjs';
import { bar, loadPress, renderLoadCard } from '../load-card.mjs';
import { holdIfLoaded } from '../load-guard.mjs';
import { t } from '../i18n.mjs';

const tr = (key, vars) => t('en', key, vars);

const READING = {
  at: 1,
  host: 'desk',
  cores: 6,
  cpuPct: 42,
  ram: { freeGb: 5.4, totalGb: 15.7, freePct: 34 },
  disk: { drive: 'C:\\', freeGb: 48.2, totalGb: 308.3, freePct: 16 },
  uptimeH: 115,
};

const ON = { enabled: true, cpuPct: 85, ramFreePct: 8, diskFreeGb: 10 };

test('the guard is off unless somebody turned it on', () => {
  // The default matters: an install that upgraded into a guard that holds turns
  // would look broken, so nothing is held until `/load on` says so.
  assert.equal(guardOf(undefined).enabled, false);
  assert.equal(guardOf({ cpuPct: 50 }).enabled, false);
  assert.equal(guardOf({ enabled: true }).cpuPct, 85);
  // A limit someone typed as text or left empty must not become NaN: NaN loses
  // every comparison, which would silently disable the limit it was meant to be.
  assert.equal(guardOf({ cpuPct: '70', ramFreePct: null }).cpuPct, 70);
  assert.equal(guardOf({ cpuPct: 'nonsense' }).cpuPct, 85);
});

test('a breach is a number past its limit, and an unknown is not a breach', () => {
  assert.deepEqual(breaches({ ...READING, cpuPct: 90 }, ON).map((one) => one.key), ['cpu']);
  assert.deepEqual(breaches({ ...READING, ram: { ...READING.ram, freePct: 3 } }, ON).map((one) => one.key), ['ram']);
  assert.deepEqual(breaches({ ...READING, disk: { ...READING.disk, freeGb: 1 } }, ON).map((one) => one.key), ['disk']);
  assert.deepEqual(breaches(READING, ON), []);
  // "Unknown" is not "full": an unplugged drive must not hold every turn forever.
  assert.deepEqual(breaches({ ...READING, disk: { drive: 'Z:\\', freeGb: null, totalGb: null } }, ON), []);
  // The switch itself is the first thing checked, not the numbers.
  assert.deepEqual(breaches({ ...READING, cpuPct: 99 }, { ...ON, enabled: false }), []);
});

test('the card prints the reading, the limits, and the bridge\'s own share', () => {
  const { text, keyboard } = renderLoadCard({ t: tr, sample: READING, guard: ON, turns: 2, queued: 1, max: 3 });
  assert.match(text, /desk/);
  assert.match(text, /CPU 42%/);
  assert.match(text, /5\.4 of 15\.7 GB free/);
  assert.match(text, /Disk C: 48\.2 of 308\.3 GB free/);
  // The row a person cannot get from Task Manager: which Electron children are
  // Telegram topics, and how many are waiting behind them.
  assert.match(text, /2 of 3 turn slots busy, 1 waiting/);
  assert.match(text, /Guard is ON/);
  assert.match(text, /CPU 85%/);
  // Over a limit is stated, not implied by a colour a phone may not show.
  const busy = renderLoadCard({ t: tr, sample: { ...READING, cpuPct: 97 }, guard: ON });
  assert.match(busy.text, /Over a limit: CPU 97% \(limit 85%\)/);
  assert.equal(busy.text.includes('⚠️'), true);
  assert.equal(keyboard.length, 1);
  assert.equal(keyboard[0].length, 2);
});

test('a card with the guard off still shows the numbers and the limits', () => {
  // Turning the guard off must not turn the meter off: the reason to look is
  // usually "is it my turn or the machine", and that question has no switch.
  const { text } = renderLoadCard({ t: tr, sample: READING, guard: { ...ON, enabled: false } });
  assert.match(text, /Guard is OFF/);
  assert.match(text, /Limits are kept/);
  assert.doesNotMatch(text, /Over a limit/);
});

test('a bar reads at a glance and never overflows', () => {
  assert.equal(bar(0), '░'.repeat(10));
  assert.equal(bar(100), '█'.repeat(10));
  assert.equal(bar(50), '█████░░░░░');
  assert.equal(bar(Number.NaN), '');
  assert.equal(bar(140), '█'.repeat(10));
});

test('a held prompt is kept, and the press that releases it gets it back once', () => {
  const id = hold('abc123', { msg: { text: 'do the thing' } });
  assert.equal(id, 'abc123');
  assert.deepEqual(takeHeld('abc123'), { msg: { text: 'do the thing' } });
  // A second press on the same notice must not run the prompt twice.
  assert.equal(takeHeld('abc123'), null);
  assert.equal(takeHeld('never-there'), null);
  // Bounded: the oldest goes, so a long-running chat cannot grow this forever.
  for (let n = 0; n < 20; n += 1) hold(`id${n}`, { n });
  assert.ok(held.size <= 8);
});

test('the guard holds a prompt instead of refusing it, and says what it saw', async () => {
  const sent = [];
  const logs = [];
  const busy = { ...READING, cpuPct: 97 };
  const held1 = await holdIfLoaded({
    t,
    lang: 'en',
    key: '1:2',
    where: 'chat=1 topic=2',
    cwd: 'C:\\work',
    chatId: 1,
    threadId: 2,
    msg: { text: 'go' },
    album: null,
    sendWithMarkup: async (...args) => sent.push(args),
    log: (line) => logs.push(line),
    guard: ON,
    sample: async () => busy,
  });
  assert.equal(held1, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0][2], /Held back: CPU 97%/);
  // Both buttons must be real: one runs it anyway, one shows the machine.
  const buttons = sent[0][3].reply_markup.inline_keyboard[0];
  assert.equal(buttons[0].callback_data.startsWith('ld:y:'), true);
  assert.equal(buttons[1].callback_data, 'ld:r');
  // The prompt itself is not lost: the notice's id points at it.
  const id = buttons[0].callback_data.slice('ld:y:'.length);
  assert.deepEqual(takeHeld(id), { msg: { text: 'go' }, album: null, chatId: 1, threadId: 2 });
  assert.match(logs[0], /turn held .*cpu 97 vs 85/);
});

test('a calm machine, a guard that is off, and a broken reading all let the turn run', async () => {
  const run = (guard, sample) => holdIfLoaded({
    t, lang: 'en', key: 'k', where: 'w', cwd: 'C:\\', chatId: 1, threadId: 0, msg: {},
    album: null, sendWithMarkup: async () => assert.fail('nothing should be sent'),
    log: () => {}, guard, sample,
  });
  assert.equal(await run(ON, async () => READING), false);
  assert.equal(await run({ ...ON, enabled: false }, async () => ({ ...READING, cpuPct: 99 })), false);
  // A meter that throws must not become a blocker: the guard is a courtesy.
  assert.equal(await run(ON, async () => { throw new Error('no statfs'); }), false);
});

test('the disk is taken from the path the turn writes to', () => {
  // Drive letters are a Windows idea; on macOS and Linux the only disk that
  // matters is `/`, and asking for `C:\` there would read nothing at all.
  assert.equal(driveOf('C:\\Users\\x', 'win32'), 'C:\\');
  assert.equal(driveOf('d:/work', 'win32'), 'd:\\');
  // A relative cwd has no drive of its own: the system one is the honest guess.
  assert.match(driveOf('work/sub', 'win32'), /^[A-Za-z]:\\$/);
  assert.equal(driveOf('/home/x', 'linux'), '/');
  assert.equal(driveOf('/Users/x', 'darwin'), '/');
  assert.equal(round1(4.907692), 4.9);
});

test('the load card\'s buttons parse, and a foreign payload does not', () => {
  assert.equal(loadPress('ld:r'), 'r');
  assert.equal(loadPress('ld:g'), 'g');
  assert.equal(loadPress('ld:y:123456'), 'y:123456');
  assert.equal(loadPress('fb:u:2'), null);
  assert.equal(loadPress(''), null);
});
