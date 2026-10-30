// Rewind is the one operation in the bridge that deletes history, so its tests
// are about refusals as much as about cutting: what it restores, what it leaves
// alone, and every case where it must do nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';
import { allTurns, applyRewind, frameOffsets, newestBackup, planRewind, recentTurns, restoreBackup } from '../work/rewind.mjs';
import { writeSession } from './rewind-fixture.mjs';

const THREE = [{ user: 'first question', answer: 'first answer' }, { user: 'second question', answer: 'second answer' }, { user: 'third question', answer: 'third answer' }];

/** Every record of the file, in file order — what the app would read back. */
function records(file) {
  const buf = readFileSync(file);
  const offsets = frameOffsets(buf);
  const out = [];
  for (let i = 0; i < offsets.length - 1; i++) {
    for (const line of zstdDecompressSync(buf.subarray(offsets[i], offsets[i + 1])).toString('utf8').split('\n')) {
      if (line.trim()) out.push(JSON.parse(line));
    }
  }
  return out;
}

test('turns are read back with the text on both sides, newest first', () => {
  const { file } = writeSession(THREE);
  const turns = recentTurns(file);
  assert.deepEqual(turns.map((turn) => turn.turn), [3, 2, 1]);
  assert.equal(turns[0].user, 'third question');
  assert.equal(turns[0].answer, 'third answer');
});

test('a tool-heavy turn is still one turn, and its answer is kept', () => {
  const { file } = writeSession(THREE, { tools: true });
  const turns = allTurns(file);
  assert.equal(turns.length, 3);
  assert.equal(turns[1].user, 'second question');
  assert.equal(turns[1].answer, 'second answer');
});

test('going back one turn removes exactly that turn and keeps the rest', () => {
  const { file } = writeSession(THREE, { tools: true });
  const before = records(file);
  const plan = planRewind(file, 1);
  assert.equal(plan.reason, '');
  assert.equal(plan.kept, 2);
  assert.equal(plan.dropped, 1);
  applyRewind(file, plan.offset, plan.size);

  const after = records(file);
  assert.deepEqual(after, before.slice(0, after.length));
  assert.equal(after.length < before.length, true);
  assert.ok(!after.some((record) => record.type === 'turn/start' && record.data.turn === 3), 'turn 3 is gone');
  assert.ok(after.some((record) => record.type === 'turn/start' && record.data.turn === 2), 'turn 2 stays');
  const turns = allTurns(file);
  assert.equal(turns.length, 2);
  assert.equal(turns[1].answer, 'second answer', 'the kept turn keeps its answer');
});

test('going back two turns leaves the first turn whole', () => {
  const { file } = writeSession(THREE, { tools: true });
  const plan = planRewind(file, 2);
  applyRewind(file, plan.offset, plan.size);
  const turns = allTurns(file);
  assert.deepEqual(turns.map((turn) => turn.turn), [1]);
  assert.equal(turns[0].answer, 'first answer');
  assert.equal(records(file).filter((record) => record.type === 'turn/end').length, 1);
});

test('the session header survives every cut', () => {
  const { file } = writeSession(THREE);
  const plan = planRewind(file, 2);
  applyRewind(file, plan.offset, plan.size);
  const head = records(file)[0];
  assert.equal(head.type, 'session');
  assert.equal(head.id, 'session-test');
});

test('the cut lands on a frame boundary, never inside one', () => {
  const { file } = writeSession(THREE, { tools: true });
  const plan = planRewind(file, 1);
  const offsets = frameOffsets(readFileSync(file));
  assert.ok(offsets.includes(plan.offset), 'the offset is a frame start');
});

test('a backup holds the whole pre-rewind file', () => {
  const { file } = writeSession(THREE);
  const sizeBefore = statSync(file).size;
  const plan = planRewind(file, 1);
  const backup = applyRewind(file, plan.offset, plan.size);
  assert.ok(existsSync(backup));
  assert.equal(statSync(backup).size, sizeBefore);
  assert.deepEqual(allTurns(backup).map((turn) => turn.turn), [1, 2, 3]);
});

test('undo puts the rewound turns back', () => {
  const { file } = writeSession(THREE);
  const plan = planRewind(file, 2);
  applyRewind(file, plan.offset, plan.size);
  const backup = newestBackup(file);
  assert.ok(backup, 'a backup exists');
  restoreBackup(backup, file);
  assert.deepEqual(allTurns(file).map((turn) => turn.turn), [1, 2, 3]);
});

test('refuses to go back further than the history goes', () => {
  const { file } = writeSession(THREE);
  const plan = planRewind(file, 3);
  assert.equal(plan.reason, 'too-many-steps');
  assert.equal(plan.offset, 0);
});

test('refuses on a nonsense count instead of guessing', () => {
  const { file } = writeSession(THREE);
  assert.equal(planRewind(file, 0).reason, 'bad-steps');
  assert.equal(planRewind(file, -2).reason, 'bad-steps');
  assert.equal(planRewind(file, 1.5).reason, 'bad-steps');
});

test('refuses a session with no turns at all', () => {
  const { file } = writeSession([{ user: 'hello' }]);
  const plan = planRewind(file, 1);
  assert.equal(plan.reason, 'too-many-steps', 'one turn is not a whole turn to keep');
});

test('refuses when a frame does not decode — that is a session being written', () => {
  const { file } = writeSession(THREE);
  const buf = readFileSync(file);
  writeFileSync(file, Buffer.concat([buf, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x01])]));
  // Writing the torn tail also touched the file, so backdate it again: this test
  // is about the undecodable frame, not about freshness.
  const old = new Date(Date.now() - 10 * 60 * 1000);
  utimesSync(file, old, old);
  assert.equal(planRewind(file, 1).reason, 'tail-incomplete');
});

test('refuses when the session grew between planning and cutting', () => {
  const { file } = writeSession(THREE);
  const plan = planRewind(file, 1);
  const grown = writeSession([...THREE, { user: 'arrived meanwhile', answer: 'answer' }]);
  assert.throws(() => applyRewind(grown.file, plan.offset, plan.size), /grew from \d+ to \d+ bytes/);
});

test('a missing file plans nothing', () => {
  const plan = planRewind('C:/definitely/not/here/session.v4.jsonl.zstd', 1);
  assert.equal(plan.reason, 'missing');
  assert.equal(recentTurns('C:/definitely/not/here/session.v4.jsonl.zstd').length, 0);
});

test('turn text is what the person said, not the system prompt', () => {
  const { file } = writeSession([
    { user: 'Кстати в гуи версии есть откат', answer: 'Да' },
    { user: 'и ещё одна правка', answer: 'Понял' },
  ]);
  const [newest, older] = recentTurns(file);
  assert.equal(newest.user, 'и ещё одна правка');
  assert.equal(older.user, 'Кстати в гуи версии есть откат');
});