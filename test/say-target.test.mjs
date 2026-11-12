// A note must land in the topic that is doing the work.
//
// Reported from a real group: a session that passed `--chat` and no `--thread`
// wrote into thread 0 — the General topic — while its card named another topic.
// `--thread` is now filled from the live marker for the folder, and the half a
// flag carries never outvotes the turn that is actually running.
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const SAY = new URL('../say.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function home({ marker }) {
  const dir = mkdtempSync(join(tmpdir(), 'say-marker-'));
  mkdirSync(join(dir, 'tg-bridge', 'active'), { recursive: true });
  mkdirSync(join(dir, 'tg-bridge', 'thoughts'), { recursive: true });
  if (marker) {
    writeFileSync(join(dir, 'tg-bridge', 'active', `${process.pid}.json`), JSON.stringify({
      pid: process.pid,
      key: `${marker.chatId}:${marker.threadId}`,
      chatId: marker.chatId,
      threadId: marker.threadId,
      cwd: process.cwd(),
      thought: join(dir, 'tg-bridge', 'thoughts', `${marker.chatId}_${marker.threadId}_t1.jsonl`),
    }), 'utf8');
  }
  return dir;
}

function run(dir, args) {
  return spawnSync(process.execPath, [SAY, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DSH_HOME: dir, DSH_TG_CHAT: '', DSH_TG_THREAD: '', DSH_TG_THOUGHT: '' },
    encoding: 'utf8',
  });
}

test('a half flag is completed from the running turn, not from General', () => {
  const dir = home({ marker: { chatId: 111, threadId: 222 } });
  const res = run(dir, ['--chat', '111', '--thought', 'half a flag']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout.trim(), /111_222_t1\.jsonl$/, 'the note must go to the turn that is running');
  assert.match(res.stderr, /--thread missing/);
});

test('a full flag is left alone', () => {
  const dir = home({ marker: { chatId: 111, threadId: 222 } });
  const res = run(dir, ['--chat', '111', '--thread', '333', '--thought', 'explicit']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout.trim(), /111_333\.jsonl$/, 'a caller that knows its topic keeps it');
  assert.ok(!res.stderr.includes('--thread missing'));
});

test('without a running turn the note still goes where it was told', () => {
  const dir = home({});
  const res = run(dir, ['--chat', '111', '--thought', 'no turn']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout.trim(), /111_0\.jsonl$/, 'no marker means no better answer than the flag');
});

test('no target at all is still a refusal, not a guess', () => {
  const dir = home({});
  const res = run(dir, ['--thought', 'lost']);
  assert.equal(res.status, 7);
  assert.match(res.stderr, /no target/);
});

// A second bridge instance (a second bot) keeps its state in its own folder:
// `DSH_TG_HOME` moves the markers, the thoughts and the steer files with it.
// Before this, `say.mjs` looked in `~/.dsh/tg-bridge` no matter what the
// instance was, so the adviser bot's 💭 lines landed in the first bot's
// thoughts folder — a file nobody reads, and the card stayed empty.
test('a second instance reads its own markers, not the first bot\'s', () => {
  const first = mkdtempSync(join(tmpdir(), 'say-first-'));
  const state = mkdtempSync(join(tmpdir(), 'say-second-'));
  const thought = join(state, 'thoughts', '111_222_t1.jsonl');
  mkdirSync(join(state, 'active'), { recursive: true });
  mkdirSync(join(state, 'thoughts'), { recursive: true });
  writeFileSync(join(state, 'active', `${process.pid}.json`), JSON.stringify({
    pid: process.pid,
    key: '111:222',
    chatId: 111,
    threadId: 222,
    cwd: process.cwd(),
    thought,
  }), 'utf8');

  const res = spawnSync(process.execPath, [SAY, '--thought', 'second instance'], {
    cwd: process.cwd(),
    env: { ...process.env, DSH_HOME: first, DSH_TG_HOME: state, DSH_TG_CHAT: '', DSH_TG_THREAD: '', DSH_TG_THOUGHT: '' },
    encoding: 'utf8',
  });

  assert.equal(res.status, 0, res.stderr);
  const lines = readFileSync(thought, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.at(-1).text, 'second instance');
  assert.ok(!existsSync(join(first, 'tg-bridge', 'thoughts')), 'the first bot\'s folder stays untouched');
});

// The preamble is built by hand in `handle-message.mjs`, and it used to name
// `<state>/say.mjs` — a file that exists only for the first instance. The
// agent's first step then died with MODULE_NOT_FOUND, and the turn went off to
// repair the bridge instead of answering the person.
test('the preamble points at the bridge\'s say.mjs, not at the state folder', () => {
  const source = readFileSync(new URL('../chat/handle-message.mjs', import.meta.url), 'utf8');
  assert.ok(!/join\(DIR, 'say\.mjs'\)/.test(source), 'the preamble must take SAY from core/paths.mjs');
  assert.match(source, /import \{[^}]*\bSAY\b[^}]*\} from '\.\.\/core\/paths\.mjs'/);
});