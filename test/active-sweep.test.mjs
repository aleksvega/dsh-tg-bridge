// A marker nobody clears is worse than no marker: it names a turn that is over.
//
// The sweep used to run only for the folder that asked, so a marker left by a
// turn in another folder stayed forever, and a marker whose pid Windows had
// handed to some other process looked alive. Eight of them had piled up in the
// first bot's folder before anyone looked.
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const state = mkdtempSync(join(tmpdir(), 'active-sweep-'));
process.env.DSH_TG_HOME = state;
const { activeDir, activeTargets, markActive } = await import('../turn/active.mjs');

// Windows pids are small and even; this one is neither, so nothing owns it.
const DEAD_PID = 0x7ffffffe;

function marker(name, record) {
  mkdirSync(activeDir(), { recursive: true });
  writeFileSync(join(activeDir(), name), JSON.stringify(record), 'utf8');
}

test('a dead marker from another folder is swept, not left behind', () => {
  marker('111.json', { pid: DEAD_PID, chatId: 1, threadId: 2, cwd: 'C:\\elsewhere', at: Date.now() });
  assert.deepEqual(activeTargets(process.cwd()), []);
  assert.deepEqual(readdirSync(activeDir()), [], 'the dead marker is gone');
});

test('a marker older than any turn is swept even if its pid is alive', () => {
  marker('222.json', {
    pid: process.pid,
    chatId: 1,
    threadId: 2,
    cwd: process.cwd(),
    at: Date.now() - 24 * 60 * 60 * 1000,
  });
  assert.deepEqual(activeTargets(process.cwd()), []);
  assert.deepEqual(readdirSync(activeDir()), [], 'yesterday\'s turn does not look alive');
});

test('a marker with no timestamp falls back to the pid', () => {
  marker('333.json', { pid: process.pid, chatId: 1, threadId: 2, cwd: process.cwd() });
  assert.equal(activeTargets(process.cwd()).length, 1, 'a live pid with no age is still a turn');
});

test('a live marker in this folder is found, and a new turn sweeps the rest', () => {
  marker('444.json', { pid: DEAD_PID, chatId: 1, threadId: 2, cwd: process.cwd(), at: Date.now() });
  markActive({ pid: process.pid, key: '1:2', chatId: 1, threadId: 2, cwd: process.cwd(), thought: '' });
  const names = readdirSync(activeDir()).sort();
  assert.deepEqual(names, [`${process.pid}.json`, '333.json'], 'the dead one went, the live ones stayed');
  assert.equal(activeTargets(process.cwd()).length, 2);
});
