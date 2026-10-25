// "What was the model thinking in the last turn?" — read straight from the
// session log instead of keeping a copy in memory.
//
// A session is `<sessions>/<cwd>/<id>/session.v4.jsonl.zstd`: one zstd frame per
// appended batch of records, and a `turn/start` record marks the beginning of a
// turn. Walking the file backwards from the newest frame is enough to reach the
// current turn, which keeps the command cheap on a 13 MB log with 16k frames.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Every zstd frame start in `buf`, ascending. */
function frameStarts(buf) {
  const starts = [];
  let at = 0;
  for (;;) {
    const found = buf.indexOf(MAGIC, at);
    if (found < 0) break;
    starts.push(found);
    at = found + MAGIC.length;
  }
  starts.push(buf.length);
  return starts;
}

/** Path of a session file, or '' when the id is unknown. */
export function sessionFile(sessionsRoot, sessionId) {
  if (!sessionId) return '';
  let dirs = [];
  try {
    dirs = readdirSync(sessionsRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return '';
  }
  for (const dir of dirs) {
    const direct = join(sessionsRoot, dir.name, sessionId, 'session.v4.jsonl.zstd');
    if (existsSync(direct)) return direct;
  }
  return '';
}

/**
 * Reasoning blocks of the last turn, oldest first. `maxChars` keeps the head of
 * the stream: that is where the plan and the first diagnosis are.
 *
 * Not every turn has reasoning to show: a one-word answer ("ok") carries a text
 * part and nothing else, and some models are not given a reasoning budget at all.
 * The caller distinguishes "no plan in this turn" from "no such session".
 */
export function lastTurnReasoning(file, { maxChars = 4000 } = {}) {
  const blocks = lastTurnBlocks(file).filter((part) => part.type === 'reasoning' && part.text);
  const text = blocks.map((part) => part.text.trim()).join('\n\n').trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/** Every part of every assistant message of the last turn, in order. */
function lastTurnBlocks(file) {
  if (!file || !existsSync(file)) return [];
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return [];
  }
  const starts = frameStarts(buf);
  const lines = [];
  let reachedTurnStart = false;
  for (let i = starts.length - 2; i >= 0 && !reachedTurnStart; i--) {
    let text = '';
    try {
      text = zstdDecompressSync(buf.subarray(starts[i], starts[i + 1])).toString('utf8');
    } catch {
      continue;
    }
    const parts = text.split('\n').filter(Boolean);
    for (let j = parts.length - 1; j >= 0; j--) {
      lines.push(parts[j]);
      if (parts[j].includes('"type":"turn/start"')) {
        reachedTurnStart = true;
        break;
      }
    }
  }
  lines.reverse();
  const out = [];
  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record?.type !== 'assistant/message') continue;
    for (const part of record.data?.message?.content ?? []) out.push(part);
  }
  return out;
}

/** The last turn's own answer text — the fallback when it planned nothing. */
export function lastTurnText(file, { maxChars = 1500 } = {}) {
  const text = lastTurnBlocks(file)
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text.trim())
    .join('\n\n')
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export { frameStarts };
