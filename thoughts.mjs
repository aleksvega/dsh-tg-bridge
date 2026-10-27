// "What was the model thinking in the last turn?" — read straight from the
// session log instead of keeping a copy in memory.
//
// A session is `<sessions>/<cwd>/<id>/session.v4.jsonl.zstd`: one zstd frame per
// appended batch of records, and a `turn/start` record marks the beginning of a
// turn. Walking the file backwards from the newest frame is enough to reach the
// current turn, which keeps the command cheap on a 13 MB log with 16k frames.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as zlib from 'node:zlib';

// Session files are zstd frames. Node24 has the codec; anything older would fail
// here with a module error nobody can act on, so the failure names the fix.
const { zstdDecompressSync } = zlib;
if (typeof zstdDecompressSync !== 'function') {
  throw new Error('dsh-tg-bridge needs Node 24 or newer: session files are zstd-compressed');
}

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

/**
 * The last turn's reasoning, complete, one entry per committed assistant step.
 * Chat text is capped (a five-hour turn would not fit any message); a file has
 * no such problem, so this keeps everything.
 */
export function lastTurnReasoningSteps(file) {
  return lastTurnBlocks(file)
    .filter((part) => part.type === 'reasoning' && part.text && part.text.trim())
    .map((part) => part.text.trim());
}

/** Reasoning of every turn of the session, oldest first: `[{ steps: [...] }]`. */
export function sessionReasoningSteps(file) {
  if (!file || !existsSync(file)) return [];
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return [];
  }
  const starts = frameStarts(buf);
  const turns = [];
  let current = null;
  for (let i = 0; i < starts.length - 1; i++) {
    let text = '';
    try {
      text = zstdDecompressSync(buf.subarray(starts[i], starts[i + 1])).toString('utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.type === 'turn/start') {
        current = { steps: [] };
        turns.push(current);
        continue;
      }
      if (record.type !== 'assistant/message') continue;
      if (!current) {
        current = { steps: [] };
        turns.push(current);
      }
      for (const part of record.data?.message?.content ?? []) {
        if (part.type === 'reasoning' && part.text && part.text.trim()) current.steps.push(part.text.trim());
      }
    }
  }
  return turns;
}

/**
 * A reasoning log as a file someone can open in an editor: a header with the
 * facts, then one section per step. Plain Markdown, because every editor and
 * Telegram's own preview render it.
 */
export function reasoningMarkdown({ title, meta = [], stepTitle = 'Step', turns = [] }) {
  const lines = [`# ${title}`, ''];
  for (const line of meta) lines.push(`- ${line}`);
  lines.push('');
  const manyTurns = turns.length > 1;
  turns.forEach((turn, turnIndex) => {
    if (!turn.steps.length) return;
    if (manyTurns) lines.push(`## ${turn.title || `${stepTitle} ${turnIndex + 1}`}`, '');
    turn.steps.forEach((step, index) => {
      lines.push(`### ${stepTitle} ${index + 1}`, '', step, '');
    });
  });
  return `${lines.join('\n').trim()}\n`;
}

/** The last turn's own answer text — the fallback when it planned nothing. */
export function lastTurnText(file, { maxChars = 1500 } = {}) {  const text = lastTurnBlocks(file)
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text.trim())
    .join('\n\n')
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * What a `/status` card wants to know about a session: when it started, when it
 * last did anything, which model answered, how big the context is now, and how
 * many tokens were billed over the session's whole life.
 *
 * `totalTokens` on an assistant message is the size of the prompt that turn sent
 * (input + cache read), i.e. the current context — not the lifetime total, which
 * is the sum over every call.
 */
export function sessionStats(file) {
  const empty = { createdAt: 0, lastActivity: 0, model: '', contextTokens: 0, lifetimeTokens: 0, turns: 0 };
  if (!file || !existsSync(file)) return empty;
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    return empty;
  }
  const stats = { ...empty };
  const starts = frameStarts(buf);
  for (let i = 0; i < starts.length - 1; i++) {
    let text = '';
    try {
      text = zstdDecompressSync(buf.subarray(starts[i], starts[i + 1])).toString('utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.type === 'session' && record.createdAt) stats.createdAt = record.createdAt;
      if (record.type === 'turn/start') stats.turns += 1;
      if (record.time) stats.lastActivity = Math.max(stats.lastActivity, record.time);
      if (record.type !== 'assistant/message') continue;
      const usage = record.data?.usage;
      if (usage) {
        if (Number.isFinite(usage.totalTokens)) stats.contextTokens = usage.totalTokens;
        const billed = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0);
        stats.lifetimeTokens += billed;
      }
      if (!stats.model && record.data?.message?.model) stats.model = record.data.message.model;
    }
  }
  return stats;
}

export { frameStarts };
