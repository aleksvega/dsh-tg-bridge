// A session in the shape the app writes it: a header frame, then one frame per
// appended batch, turns marked by turn/start and turn/end. Built here so the
// rewind tests do not depend on a real 20 MB session staying on disk.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';

const frame = (records) => zstdCompressSync(Buffer.from(`${records.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8'));

/**
 * `turns` turns, each: user text, assistant text, and (when `tools`) a tool call
 * and its result, so the tests can see that tool frames belong to the turn.
 */
export function writeSession(turns, { header = true, tools = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rewind-'));
  const file = join(dir, 'session.v4.jsonl.zstd');
  const frames = [];
  let seq = 0;
  const next = () => (seq += 1);
  if (header) frames.push(frame([{ type: 'session', seq: 0, version: 4, id: 'session-test', createdAt: 1 }]));
  turns.forEach((turn, index) => {
    const number = index + 1;
    if (turn.user) {
      frames.push(frame([{ type: 'user/message', seq: next(), data: { role: 'user', content: [{ type: 'text', text: turn.user }] } }]));
    }
    frames.push(frame([{ type: 'turn/start', seq: next(), data: { turn: number } }]));
    if (tools) {
      frames.push(frame([{ type: 'step/start', seq: next(), data: { turn: number, step: 1 } }]));
      frames.push(frame([{ type: 'tool/call', seq: next(), data: { turn: number, step: 1, call: { id: 'c1', name: 'pwsh', input: '{}' } } }]));
      frames.push(frame([{ type: 'tool/result', seq: next(), data: { turn: number, step: 1, result: { content: 'out' } } }]));
    }
    if (turn.answer) {
      frames.push(frame([{ type: 'assistant/message', seq: next(), data: { turn: number, message: { role: 'assistant', content: [{ type: 'text', text: turn.answer }] } } }]));
    }
    frames.push(frame([{ type: 'turn/end', seq: next(), data: { turn: number, reason: { kind: 'completed' } } }]));
  });
  writeFileSync(file, Buffer.concat(frames));
  return { file, dir, frames: frames.length };
}